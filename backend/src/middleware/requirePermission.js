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

/**
 * Gate a route on holding AT LEAST ONE of several permissions. Used where a single
 * endpoint serves a few distinct capabilities and the handler enforces which fields
 * each one may touch — e.g. PATCH /users/:id, reachable by manageUsers OR changeRoles
 * OR deactivateUsers, with the service checking the specific permission per change.
 */
export function requireAnyPermission(...actions) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json(fail('UNAUTHENTICATED', 'Authentication required'));
      return;
    }
    if (!actions.some((a) => can(req.user, a))) {
      res.status(403).json(fail('FORBIDDEN', 'You do not have permission to do that'));
      return;
    }
    next();
  };
}
