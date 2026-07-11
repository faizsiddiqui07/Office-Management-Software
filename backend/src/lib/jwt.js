import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
// Effectively a lifetime session (~10 years) — staff stay signed in until they hit
// Logout, instead of being kicked out every week. Override with JWT_EXPIRES_IN.
const DEFAULT_EXPIRY = process.env.JWT_EXPIRES_IN || '3650d';

export const AUTH_COOKIE = 'om_token';

export function signToken(payload, options) {
  return jwt.sign(payload, SECRET, { expiresIn: DEFAULT_EXPIRY, ...options });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}
