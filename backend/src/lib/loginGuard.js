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

/** Minutes left on an account's lock, or 0 when it may try. */
export async function lockedFor(email) {
  if (!email) return 0;
  const row = await LoginAttempt.findOne({ email: email.toLowerCase() }).select('lockedUntil');
  if (!row?.lockedUntil) return 0;
  const ms = row.lockedUntil.getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

/**
 * Record a wrong password. Returns the minutes the account is now locked for, or 0.
 * A run that started longer than the window ago restarts rather than accumulating
 * forever, so occasional typos over weeks never add up to a lockout.
 */
export async function recordFailure(email, ip = '') {
  if (!email) return 0;
  const key = email.toLowerCase();
  const now = Date.now();
  const row = await LoginAttempt.findOne({ email: key });

  if (!row) {
    await LoginAttempt.create({ email: key, fails: 1, firstFailAt: new Date(), lastIp: ip });
    return 0;
  }
  const stale = now - new Date(row.firstFailAt || 0).getTime() > WINDOW_MS;
  row.fails = stale ? 1 : row.fails + 1;
  if (stale) row.firstFailAt = new Date();
  row.lastIp = ip;
  if (row.fails >= MAX_FAILS) {
    row.lockedUntil = new Date(now + LOCK_MS);
    row.fails = 0; // the lock replaces the run; counting restarts after it expires
    row.firstFailAt = new Date();
    await row.save();
    return Math.ceil(LOCK_MS / 60000);
  }
  await row.save();
  return 0;
}

/** A correct password wipes the slate. */
export async function clearFailures(email) {
  if (!email) return;
  await LoginAttempt.deleteOne({ email: email.toLowerCase() });
}
