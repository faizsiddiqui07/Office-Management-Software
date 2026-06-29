import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import path from 'node:path';

import { connectDB } from './config/db.js';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { ensureSystemRoles, runRoleMigrations, loadRoles } from './lib/roles.js';

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

/* ── Static: uploaded files (expense receipts, later phases) ── */
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

/* ── API routes ──────────────────────────────────────────── */
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
  await connectDB();
  await ensureSystemRoles();
  const migrated = await runRoleMigrations();
  if (migrated) console.log('🔁 Applied role permission migration (v2)');
  const n = await loadRoles();
  console.log(`🔐 Loaded ${n} roles into the permission cache`);
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
