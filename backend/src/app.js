import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import { connectDB } from './config/db.js';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { ensureSystemRoles, runRoleMigrations, ensureRoleManagerExists, loadRoles } from './lib/roles.js';
import { ensureDefaultHolidays } from './services/holiday.service.js';

/**
 * The Express app is built here and shared by BOTH entry points:
 *   - src/index.js   → runs it as a normal local server (app.listen) for dev.
 *   - src/lambda.js  → wraps it for AWS Lambda + API Gateway.
 * Nothing here is Lambda-specific, so local behaviour is unchanged.
 */
export const app = express();

// Behind API Gateway / a proxy, the real client IP is in X-Forwarded-For.
// Without this, req.ip is undefined on Lambda and the rate-limiter crashes.
app.set('trust proxy', true);

/* ── Security & infra middleware ─────────────────────────── */
// Auth is via Bearer token (Authorization header), NOT cookies — so there's no
// CSRF/ambient-credential risk and we can allow any origin. This avoids the
// cross-domain CORS/cookie problems entirely (localhost ↔ Lambda ↔ your domain).
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors()); // reflect any origin, handle preflight, allow the Authorization header
app.use(cookieParser());
app.use(express.json({ limit: '12mb' })); // headroom for base64 logo + background uploads
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

/* ── API routes ──────────────────────────────────────────── */

/**
 * Nothing this API returns may be cached. Every response is one person's private,
 * live data — a task list, an attendance sheet, a leave balance — and there is no
 * such thing as a stale-but-acceptable version of it.
 *
 * This is the fix for the iPhone showing work that had already been deleted. iOS
 * caches a GET aggressively when the response says nothing about caching, so the app
 * kept being handed an answer from before the change. The service worker was never
 * the culprit and neither was the query cache: it was the browser's own HTTP cache,
 * doing exactly what it is allowed to do when nobody tells it otherwise.
 *
 * `no-store` rather than `no-cache`: no-cache still stores the response and merely
 * revalidates, which on a flaky mobile connection is how a stale body gets served.
 * Pragma and Expires are there for older proxies that ignore Cache-Control.
 */
app.use('/api', (_req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
  });
  next();
});

app.use('/api', apiRouter);

/* ── 404 + global error handler (must be last) ───────────── */
app.use(notFoundHandler);
app.use(errorHandler);

/* ── One-time initialisation (DB + roles), cached + retryable ──
 * On Lambda this runs once per warm container; locally, once at boot.
 */
let initPromise = null;

async function runInit() {
  if (!process.env.MONGODB_URI) {
    console.warn('⚠️  MONGODB_URI not set — running without a database.');
    return;
  }
  // ONLY what a request genuinely needs before it can be served: the DB connection and
  // the role/permission cache. This used to also run the seed/migration/repair jobs
  // (system roles, role migrations, admin-lockout failsafe, default holidays) — five more
  // sequential DB round-trips — which meant every COLD Lambda container spent ~9s inside
  // the first request it served. Those jobs are one-time/self-healing maintenance, not
  // request prerequisites, so they now run on the EventBridge tick (see runSetupTasks).
  await connectDB();
  let n = await loadRoles();
  if (!n) {
    // A genuinely empty roles collection (first boot of a fresh install) — seed now, or
    // no one can log in. Existing installs never hit this branch.
    await ensureSystemRoles();
    n = await loadRoles();
  }
  console.log(`🔐 Loaded ${n} roles into the permission cache`);
}

/**
 * One-time / self-healing maintenance, run from the EventBridge tick — NOT from the
 * request path. Each step is idempotent and cheap once it has nothing to do.
 */
export async function runSetupTasks() {
  await ensureSystemRoles();
  const migrated = await runRoleMigrations();
  if (migrated) console.log('🔁 Applied role permission migration (v2)');
  const repaired = await ensureRoleManagerExists();
  if (repaired) console.log('🛟 Restored role-management access (admin-lockout failsafe)');
  await loadRoles(); // refresh the cache in THIS container after any repairs
  const { added, converted, birthdays } = await ensureDefaultHolidays();
  if (added || converted || birthdays) {
    console.log(`🗓️  Calendar: added ${added} national holiday(s), set ${converted} existing one(s) + ${birthdays} birthday(s) to repeat`);
  }
}

export function initApp() {
  if (!initPromise) {
    initPromise = runInit().catch((err) => {
      console.error('⚠️  Initialisation failed:', err);
      initPromise = null; // allow a retry on the next call / Lambda invocation
    });
  }
  return initPromise;
}
