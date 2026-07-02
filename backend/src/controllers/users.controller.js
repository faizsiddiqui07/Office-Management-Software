import { ok, fail } from '../lib/apiResponse.js';
import { canAssignRole } from '../lib/permissions.js';
import { User } from '../models/User.js';
import { createEmployee, resetUserCredentials, updateUser as updateUserService } from '../services/user.service.js';
import { getBalanceForUser, setLeaveBalance } from '../services/leave.service.js';
import { getUserDossier } from '../services/dossier.service.js';
import { audit } from '../models/AuditLog.js';

function sendServiceError(res, err, next) {
  if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
  return next(err);
}

export async function listUsers(_req, res, next) {
  try {
    const users = await User.find().sort({ createdAt: -1 }).limit(200);
    res.json(ok({ users: users.map((u) => u.toJSON()) }));
  } catch (err) {
    next(err);
  }
}

export async function createUser(req, res, next) {
  try {
    const { role } = req.body;
    if (!canAssignRole(req.user.role, role)) {
      return res.status(403).json(fail('FORBIDDEN', 'You cannot create a user with that role'));
    }

    const { user, tempPassword } = await createEmployee({ ...req.body, createdBy: req.user._id });
    await audit({
      actor: req.user._id,
      action: 'user.create',
      entityType: 'User',
      entityId: user._id.toString(),
      meta: { role: user.role, employeeId: user.employeeId },
    });

    // Return the plaintext temp password ONCE — never stored or shown again.
    return res.status(201).json(ok({ user: user.toJSON(), temporaryPassword: tempPassword }));
  } catch (err) {
    return sendServiceError(res, err, next);
  }
}

export async function resetCredentials(req, res, next) {
  try {
    const { id } = req.params;
    const { user, tempPassword } = await resetUserCredentials(id);
    await audit({
      actor: req.user._id,
      action: 'user.reset_credentials',
      entityType: 'User',
      entityId: id,
    });
    return res.json(ok({ user: user.toJSON(), temporaryPassword: tempPassword }));
  } catch (err) {
    return sendServiceError(res, err, next);
  }
}

export async function updateUser(req, res, next) {
  try {
    const user = await updateUserService(req.user, req.params.id, req.body);
    await audit({ actor: req.user._id, action: 'user.update', entityType: 'User', entityId: req.params.id, meta: req.body });
    return res.json(ok({ user }));
  } catch (err) {
    return sendServiceError(res, err, next);
  }
}

/** Full per-user dossier (attendance + leaves + tasks + activity) for a date range. */
export async function userDossier(req, res, next) {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json(fail('BAD_RANGE', 'from and to dates are required'));
    if (to < from) return res.status(400).json(fail('BAD_RANGE', 'End date is before the start date'));
    const data = await getUserDossier(req.params.id, { from, to });
    return res.json(ok(data));
  } catch (err) {
    return sendServiceError(res, err, next);
  }
}

/** Current fiscal-year leave balance for an employee (for the edit dialog). */
export async function getLeaveBalance(req, res, next) {
  try {
    const balance = await getBalanceForUser(req.params.id);
    return res.json(ok({ balance }));
  } catch (err) {
    return sendServiceError(res, err, next);
  }
}

/** Leadership override of an employee's quota / already-used leave days. */
export async function updateLeaveBalance(req, res, next) {
  try {
    const balance = await setLeaveBalance(req.params.id, req.body || {});
    await audit({ actor: req.user._id, action: 'user.leave_balance', entityType: 'User', entityId: req.params.id, meta: req.body });
    return res.json(ok({ balance }));
  } catch (err) {
    return sendServiceError(res, err, next);
  }
}
