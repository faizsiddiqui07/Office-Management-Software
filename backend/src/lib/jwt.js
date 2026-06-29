import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const DEFAULT_EXPIRY = process.env.JWT_EXPIRES_IN || '7d';

export const AUTH_COOKIE = 'om_token';

export function signToken(payload, options) {
  return jwt.sign(payload, SECRET, { expiresIn: DEFAULT_EXPIRY, ...options });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}
