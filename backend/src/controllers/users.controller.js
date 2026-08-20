import { ok, fail } from '../lib/apiResponse.js';
import { can, canAssignRole } from '../lib/permissions.js';
import { companyDayFromYMD, ymdInTz } from '../lib/time.js';
import { roleLabel } from '../lib/roles.js';
import { publicAppUrl } from '../lib/appUrl.js';
import { sendWelcomeEmail } from '../lib/mailer.js';
import { Setting } from '../models/Setting.js';
import { User } from '../models/User.js';
import { createEmployee, resetUserCredentials, updateUser as updateUserService, deleteUser as deleteUserService, exitSummary as exitSummaryService } from '../services/user.service.js';
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
    // Bound the span so a crafted range (e.g. to=9999-12-31, which passes the YMD regex)
    // can't make the day-by-day builder allocate millions of rows and OOM the Lambda.
    if ((companyDayFromYMD(to).getTime() - companyDayFromYMD(from).getTime()) / 86400000 > 400) {
      return res.status(400).json(fail('RANGE_TOO_WIDE', 'Pick a range of at most about a year.'));
    }

    const data = await buildSelfReport({ user, type: 'custom', dateYMD: to, range: { from, to } });
    await audit({ actor: req.user._id, action: 'report.download', entityType: 'User', entityId: String(user._id), meta: { scope: 'user', from, to } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${user.employeeId || user._id}-${from}_to_${to}.pdf"`);
    // Attendance only for someone who actually self-tracks it — leadership have no
    // check-ins, so an attendance section would print them "absent" every working day
    // at 0%, contradicting the dossier and the company report which both skip them.
    // Dues are deliberately excluded (that ledger is between the person and the admin).
    const tracks = can({ role: user.role }, 'markAttendance');
    // Attendance + WFH only for self-tracking roles; task stats + leaves for everyone.
    const sections = tracks ? ['attendance', 'tasks', 'leaves', 'wfh'] : ['tasks', 'leaves'];
    const stream = await renderSelfReportToStream(data, sections, await loadCompanyLogo(data.company.logoDark || data.company.logoUrl || data.company.logoLight));
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

    // Email the new employee their sign-in details. Best-effort: a mail failure (or SMTP
    // not configured) must NEVER fail the account creation — the temp password is still
    // returned below so the admin can share it by hand. `emailed` tells the UI which
    // happened, so it can show "sent to <email>" or prompt to share manually.
    let emailed = { delivered: false, to: user.email };
    try {
      const settings = await Setting.getSingleton();
      emailed = await sendWelcomeEmail(user.email, {
        name: user.name,
        employeeId: user.employeeId,
        tempPassword,
        roleLabel: roleLabel(user.role),
        joiningLabel: user.dateOfJoining ? ymdInTz(user.dateOfJoining) : '',
        loginUrl: `${publicAppUrl()}/login`,
        companyName: settings?.companyName,
      });
    } catch (mailErr) {
      console.error('welcome email failed', mailErr?.message);
    }

    // Return the plaintext temp password ONCE — never stored or shown again.
    return res.status(201).json(ok({ user: user.toJSON(), temporaryPassword: tempPassword, emailed }));
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

/** Open items to clear before offboarding a user (tasks, dues, leaves, points). */
export async function exitSummary(req, res, next) {
  try {
    return res.json(ok(await exitSummaryService(req.params.id)));
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
