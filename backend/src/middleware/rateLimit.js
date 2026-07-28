import rateLimit from 'express-rate-limit';
import { clientIp } from '../lib/loginGuard.js';

/**
 * A coarse per-address ceiling on the auth endpoints — a blunt stop on floods, NOT the
 * brute-force protection. That job belongs to the per-account lock in lib/loginGuard.js,
 * which lives in the database and therefore actually holds across instances.
 *
 * Two things this deliberately does differently from before:
 *  - the key is the address the GATEWAY saw (rightmost X-Forwarded-For), not the
 *    leftmost entry the caller can write themselves and rotate on every request;
 *  - the allowance is generous, because the whole office shares one public address.
 *    At twenty, a handful of people mistyping passwords locked everyone out of the
 *    building's connection — while an attacker simply moved address and carried on.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  // Behind API Gateway/Lambda req.ip can be undefined — never throw, and skip the
  // strict IP/proxy validations that assume a normal Express deployment.
  validate: false,
  keyGenerator: clientIp,
  message: {
    ok: false,
    error: { code: 'RATE_LIMITED', message: 'Too many attempts, please try again later.' },
  },
});
