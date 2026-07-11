import { AUTH_COOKIE } from './jwt.js';

const VALID_SAMESITE = new Set(['lax', 'strict', 'none']);

export function cookieOptions() {
  // Trim + validate so a stray space/typo in COOKIE_SAMESITE can't produce an
  // invalid value (the `cookie` lib throws "option sameSite is invalid").
  const raw = String(process.env.COOKIE_SAMESITE || 'lax').trim().toLowerCase();
  const sameSite = VALID_SAMESITE.has(raw) ? raw : 'lax';
  // sameSite=none requires Secure cookies. In local http dev, keep secure=false.
  const secure =
    String(process.env.COOKIE_SECURE || 'false').trim().toLowerCase() === 'true' || sameSite === 'none';
  return { httpOnly: true, sameSite, secure, path: '/' };
}

export function setAuthCookie(res, token) {
  // Best-effort: the Bearer token is the primary auth, so a cookie error (e.g. an
  // environment quirk) must never break login/the response.
  try {
    res.cookie(AUTH_COOKIE, token, {
      ...cookieOptions(),
      maxAge: 1000 * 60 * 60 * 24 * 3650, // ~10 years — lifetime session, until manual logout
    });
  } catch {
    // ignore — token auth still works
  }
}

export function clearAuthCookie(res) {
  try {
    res.clearCookie(AUTH_COOKIE, cookieOptions());
  } catch {
    // ignore
  }
}
