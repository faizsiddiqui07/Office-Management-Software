import { LoginAttempt } from '../models/LoginAttempt.js';

// A run of wrong passwords for ONE account, and how long that account then rests.
const MAX_FAILS = 8;
const WINDOW_MS = 15 * 60 * 1000; // fails older than this start a fresh run
const LOCK_MS = 15 * 60 * 1000;

/**
 * The real client address behind API Gateway.
 *
 * X-Forwarded-For is a list the client can start themselves, and the gateway APPENDS
 * the address it actually saw to the RIGHT of whatever arrived. Reading the left-hand
 * entry (which is what `req.ip` does with `trust proxy`) therefore reads a value the
 * caller chose — send a different one each time and every request lands in its own
 * bucket, which is no limit at all. The rightmost entry is the one the gateway wrote.
 */
export function clientIp(req) {
  const xff = req.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.headers?.['x-real-ip'] || req.ip || 'unknown';
}

/**
 * A run is counted against the account AND the address it's coming from.
 *
 * Keying on the account alone made it trivial to lock somebody out on purpose: knowing
 * an email address was enough to freeze that person's sign-in from anywhere, over and
 * over. Pairing it with the address means a stranger's wrong guesses can never stop the
 * real person signing in from their own connection, while a run from any ONE source
 * still stops after a handful of tries. Guessing from many different addresses is the
 * case the IP ceiling and the gateway-set address (which a caller cannot forge) cover.
 */
const keyFor = (email, ip) => `${String(email).toLowerCase()}|${ip || 'unknown'}`;

/** Minutes left on this account+address lock, or 0 when it may try. */
export async function lockedFor(email, ip = '') {
  if (!email) return 0;
  const row = await LoginAttempt.findOne({ email: keyFor(email, ip) }).select('lockedUntil');
  if (!row?.lockedUntil) return 0;
  const ms = row.lockedUntil.getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

/**
 * Record a wrong password. Returns the minutes it is now locked for, or 0.
 *
 * One atomic step: read-modify-write let a burst of parallel guesses all read the same
 * count and each write back the same +1, so a run of a hundred could register as a
 * handful and the lock barely engaged. $inc is applied by the database itself, so every
 * attempt counts exactly once however many arrive together.
 *
 * A run that started longer than the window ago restarts rather than accumulating
 * forever, so occasional typos spread over weeks never add up to a lockout.
 */
export async function recordFailure(email, ip = '') {
  if (!email) return 0;
  const key = keyFor(email, ip);
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  // Reset the run in the same breath when the previous one has aged out.
  const row = await LoginAttempt.findOneAndUpdate(
    { email: key },
    [
      {
        $set: {
          fails: {
            $cond: [{ $lt: [{ $ifNull: ['$firstFailAt', new Date(0)] }, windowStart] }, 1, { $add: [{ $ifNull: ['$fails', 0] }, 1] }],
          },
          firstFailAt: {
            $cond: [{ $lt: [{ $ifNull: ['$firstFailAt', new Date(0)] }, windowStart] }, now, { $ifNull: ['$firstFailAt', now] }],
          },
          lastIp: ip,
        },
      },
    ],
    { upsert: true, new: true },
  );

  if ((row?.fails ?? 0) >= MAX_FAILS) {
    const until = new Date(Date.now() + LOCK_MS);
    // The lock replaces the run; counting restarts once it expires.
    await LoginAttempt.updateOne({ email: key }, { $set: { lockedUntil: until, fails: 0, firstFailAt: new Date() } });
    return Math.ceil(LOCK_MS / 60000);
  }
  return 0;
}

/** A correct password (or a new one) wipes the slate for this account, everywhere. */
export async function clearFailures(email) {
  if (!email) return;
  // Every address's run for this account — a fresh password should clear them all.
  await LoginAttempt.deleteMany({ email: new RegExp(`^${escapeRegex(String(email).toLowerCase())}\\|`) });
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
