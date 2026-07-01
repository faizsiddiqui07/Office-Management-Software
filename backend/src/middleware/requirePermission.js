import { can } from '../lib/permissions.js';
import { fail } from '../lib/apiResponse.js';

/**
 * Gate a route on a permission action (from lib/permissions.js `can()`).
 * Assumes `requireAuth` ran first so `req.user` is present.
 */
export function requirePermission(action) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json(fail('UNAUTHENTICATED', 'Authentication required'));
      return;
    }
    if (!can(req.user, action)) {
      res.status(403).json(fail('FORBIDDEN', `You do not have permission to do that (requires “${action}”)`));
      return;
    }
    next();
  };
}
