import { AUTH_COOKIE, verifyToken } from '../lib/jwt.js';
import { fail } from '../lib/apiResponse.js';
import { User } from '../models/User.js';
import { ensureRolesFresh } from '../lib/roles.js';

/** Pull the JWT from the `Authorization: Bearer <token>` header or the cookie. */
function extractToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim();
  return req.cookies?.[AUTH_COOKIE] || null;
}

/**
 * Verifies the JWT (from the Authorization header OR the auth cookie), loads the
 * user from the DB (without passwordHash), and attaches it as `req.user`.
 * The header works across domains (e.g. frontend ↔ Lambda) where cookies don't.
 */
export async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json(fail('UNAUTHENTICATED', 'Authentication required'));
    return;
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json(fail('UNAUTHENTICATED', 'Invalid or expired session'));
    return;
  }

  try {
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) {
      res.status(401).json(fail('UNAUTHENTICATED', 'Session is no longer valid'));
      return;
    }
    // This instance's role cache may predate a role created on another instance —
    // refresh it when stale so permissions and labels don't lag behind. Best-effort:
    // a hiccup here must never lock anyone out.
    try {
      await ensureRolesFresh();
    } catch (e) {
      console.error('role cache refresh failed', e?.message);
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
