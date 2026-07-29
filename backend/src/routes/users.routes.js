import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../middleware/requirePermission.js';
import { validate } from '../middleware/validate.js';
import { ensureRolesFresh } from '../lib/roles.js';
import { createUserSchema, updateUserSchema, leaveBalanceSchema } from '../validators/users.validators.js';
import {
  createUser,
  resetCredentials,
  listUsers,
  updateUser,
  deleteUser,
  userDossier,
  userReport,
  getLeaveBalance,
  updateLeaveBalance,
} from '../controllers/users.controller.js';

export const usersRouter = express.Router();

/**
 * A role created moments ago on another instance isn't in this one's cache yet, so the
 * `role` validator would reject it as "Invalid role". Reload before validating when the
 * submitted key is unknown, so a brand-new role works immediately from any instance.
 */
async function freshRoles(req, _res, next) {
  try {
    if (req.body?.role) await ensureRolesFresh(req.body.role);
  } catch (e) {
    console.error('role cache refresh failed', e?.message);
  }
  next();
}

usersRouter.use(requireAuth);
usersRouter.get('/', requirePermission('viewEveryone'), listUsers);
usersRouter.get('/:id/dossier', requirePermission('viewEveryone'), userDossier);
usersRouter.get('/:id/report.pdf', requirePermission('viewEveryone'), userReport); // full per-user PDF for a range
usersRouter.post('/', requirePermission('createUsers'), freshRoles, validate(createUserSchema), createUser);
// Reachable by any of the three user-editing capabilities; updateUser() enforces
// which fields each one may actually change (profile → manageUsers, role →
// changeRoles, active status → deactivateUsers), so the granular toggles are real.
usersRouter.patch('/:id', requireAnyPermission('manageUsers', 'changeRoles', 'deactivateUsers'), freshRoles, validate(updateUserSchema), updateUser);
usersRouter.delete('/:id', requirePermission('manageUsers'), deleteUser); // deactivated users only (enforced in service)
usersRouter.get('/:id/leave-balance', requirePermission('manageUsers'), getLeaveBalance);
usersRouter.patch('/:id/leave-balance', requirePermission('manageUsers'), validate(leaveBalanceSchema), updateLeaveBalance);
usersRouter.post('/:id/reset-credentials', requirePermission('resetCredentials'), resetCredentials);
