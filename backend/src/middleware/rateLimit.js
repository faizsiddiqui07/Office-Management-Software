import rateLimit from 'express-rate-limit';

/** Applied to auth-sensitive endpoints (login, forgot-password) in later phases. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // Behind API Gateway/Lambda req.ip can be undefined — never throw; fall back
  // to the forwarded header (and skip strict IP/proxy validations).
  validate: false,
  keyGenerator: (req) =>
    req.ip ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    'global',
  message: {
    ok: false,
    error: { code: 'RATE_LIMITED', message: 'Too many attempts, please try again later.' },
  },
});
