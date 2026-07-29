import { ok, fail } from '../lib/apiResponse.js';
import { canAssignRole } from '../lib/permissions.js';
import { User } from '../models/User.js';
import { createEmployee, resetUserCredentials, updateUser as updateUserService, deleteUser as deleteUserService } from '../services/user.service.js';
import { getBalanceForUser, setLeaveBalance } from '../services/leave.service.js';
import { getUserDossier } from '../services/dossier.service.js';
import { buildSelfReport } from '../services/report.service.js';
import { renderSelfReportToStream } from '../services/reportPdf.service.js';
import { loadCompanyLogo } from '../lib/brand.js';
import { audit } from '../models/AuditLog.js';

function sendServiceError(res, err, next) {
  if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
  return next(err);
}

const isYMD = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Full attendance + leave report for ONE user over a custom date range, as a PDF.
 * Leadership-only (viewEveryone), downloaded from the user page. The from/to come
 * straight from the range the page is showing (7 days / this month / 90 days / custom),
 * so the report always matches what's on screen.
 */
export async function userReport(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json(fail('NOT_FOUND', 'User not found'));
    const { from, to } = req.query;
    if (!isYMD(from) || !isYMD(to)) return res.status(400).json(fail('BAD_RANGE', 'from and to dates are required'));
    if (to < from) return res.status(400).json(fail('BAD_RANGE', 'End date is before the start date'));

    const data = await buildSelfReport({ user, type: 'custom', dateYMD: to, range: { from, to } });
    await audit({ actor: req.user._id, action: 'report.download', entityType: 'User', entityId: String(user._id), meta: { scope: 'user', from, to } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${user.employeeId || user._id}-${from}_to_${to}.pdf"`);
    // Attendance + leaves only — a person's dues ledger is between them and the admin,
    // and the dossier doesn't surface it either.
    const stream = await renderSelfReportToStream(data, ['attendance', 'leaves'], loadCompanyLogo(data.company.logoDark || data.company.logoUrl || data.company.logoLight));
    stream.on('error', (err) => next(err));
    stream.pipe(res);
    return undefined;
  } catch (err) {
    return sendServiceError(res, err, next);
  }
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
    const { user, tempPassword } = await resetUserCredentials(req.user, id);
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

/** Permanently delete a deactivated user + their data. */
export async function deleteUser(req, res, next) {
  try {
    await deleteUserService(req.user, req.params.id);
    await audit({ actor: req.user._id, action: 'user.delete', entityType: 'User', entityId: req.params.id });
    return res.json(ok({ success: true }));
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
    const balance = await setLeaveBalance(req.user, req.params.id, req.body || {});
    await audit({ actor: req.user._id, action: 'user.leave_balance', entityType: 'User', entityId: req.params.id, meta: req.body });
    return res.json(ok({ balance }));
  } catch (err) {
    return sendServiceError(res, err, next);
  }
}
