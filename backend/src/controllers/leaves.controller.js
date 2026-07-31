import { ok, fail } from '../lib/apiResponse.js';
import { can } from '../lib/permissions.js';
import { applyLeaveSchema, decisionSchema, listLeavesQuerySchema } from '../validators/leaves.validators.js';
import * as svc from '../services/leave.service.js';
import { renderLeaveLedgerToStream } from '../services/reportPdf.service.js';
import { loadCompanyLogo } from '../lib/brand.js';
import { currentLeaveYear } from '../lib/leaveYear.js';
import { User } from '../models/User.js';
import { audit } from '../models/AuditLog.js';

function handleErr(res, err, next) {
  if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
  return next(err);
}

/**
 * A one-employee leave-ledger PDF for a fiscal year. Anyone can pull their OWN; only a
 * viewEveryone holder can pull someone else's (via ?userId=). Defaults to this year.
 */
export async function leaveLedger(req, res, next) {
  try {
    let target = req.user;
    if (req.query.userId && String(req.query.userId) !== String(req.user._id)) {
      if (!can(req.user, 'viewEveryone')) return res.status(403).json(fail('FORBIDDEN', 'You can only download your own leave ledger'));
      target = await User.findById(req.query.userId);
      if (!target) return res.status(404).json(fail('NOT_FOUND', 'User not found'));
    }
    const y = Number(req.query.year);
    const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : currentLeaveYear();

    const data = await svc.buildLeaveLedger(target, year);
    await audit({ actor: req.user._id, action: 'leave.ledger_download', entityType: 'User', entityId: String(target._id), meta: { year } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="leave-ledger-${target.employeeId || target._id}-${data.period.label.replace(/[^\w-]/g, '')}.pdf"`);
    const stream = await renderLeaveLedgerToStream(data, loadCompanyLogo(data.company.logoDark || data.company.logoUrl || data.company.logoLight));
    stream.on('error', (err) => next(err));
    stream.pipe(res);
    return undefined;
  } catch (err) {
    return handleErr(res, err, next);
  }
}

/** CEO & President: declare one day work-from-home for the whole office. */
export async function declareWfhDay(req, res, next) {
  try {
    const { dateYMD, note } = req.body || {};
    const result = await svc.declareOfficeWideWFH(req.user, dateYMD, note);
    await audit({ actor: req.user._id, action: 'wfh.declare', entityType: 'Attendance', entityId: result.dateYMD, meta: { applied: result.appliedCount, skipped: result.skipped.length } });
    return res.json(ok(result));
  } catch (err) {
    return handleErr(res, err, next);
  }
}

/** CEO & President: undo an office-wide WFH day (removes only the rows it created). */
export async function undoWfhDay(req, res, next) {
  try {
    const result = await svc.undoOfficeWideWFH(req.user, req.query.dateYMD || req.body?.dateYMD);
    await audit({ actor: req.user._id, action: 'wfh.undo', entityType: 'Attendance', entityId: result.dateYMD, meta: { removed: result.removed } });
    return res.json(ok(result));
  } catch (err) {
    return handleErr(res, err, next);
  }
}

/** The office-wide WFH days declared so far. */
export async function wfhDays(_req, res, next) {
  try {
    return res.json(ok({ days: await svc.officeWideWFHDays() }));
  } catch (err) {
    return next(err);
  }
}

export async function balance(req, res, next) {
  try {
    const targetId =
      req.query.userId && can(req.user, 'viewEveryone') ? req.query.userId : req.user._id;
    res.json(ok({ balance: await svc.getBalanceForUser(targetId) }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function apply(req, res, next) {
  try {
    const body = applyLeaveSchema.parse(req.body);
    const request = await svc.applyLeave(req.user, body);
    await audit({
      actor: req.user._id,
      action: 'leave.apply',
      entityType: 'LeaveRequest',
      entityId: request.id,
      meta: { type: request.type, days: request.workingDays },
    });
    res.status(201).json(ok({ request }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

/** Leadership records + auto-approves a leave FOR an employee (from the attendance editor). */
export async function record(req, res, next) {
  try {
    const { userId, startYMD, endYMD, type, reason } = req.body || {};
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    if (!userId || !ymd.test(startYMD || '') || !ymd.test(endYMD || '')) {
      return res.status(400).json(fail('BAD_INPUT', 'userId and valid dates are required'));
    }
    // Paid/Unpaid retired — only Casual and Sick can be recorded now (see lib/leave.js).
    if (!['CASUAL', 'SICK'].includes(type)) {
      return res.status(400).json(fail('BAD_TYPE', 'Pick a valid leave type'));
    }
    const request = await svc.recordLeaveForUser(req.user, userId, { type, startYMD, endYMD, reason });
    await audit({ actor: req.user._id, action: 'leave.record', entityType: 'LeaveRequest', entityId: request.id, meta: { userId, type, days: request.workingDays } });
    res.json(ok({ request }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function update(req, res, next) {
  try {
    const body = applyLeaveSchema.parse(req.body);
    const request = await svc.updateLeave(req.user, req.params.id, body);
    await audit({
      actor: req.user._id,
      action: 'leave.edit',
      entityType: 'LeaveRequest',
      entityId: req.params.id,
      meta: { type: request.type, days: request.workingDays },
    });
    res.json(ok({ request }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function list(req, res, next) {
  try {
    const q = listLeavesQuerySchema.parse(req.query);
    const requests = await svc.listLeaves(req.user, { ...q, queue: q.queue === 'true' });
    res.json(ok({ requests }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function decision(req, res, next) {
  try {
    const { decision: d, note } = decisionSchema.parse(req.body);
    const request = await svc.decideLeave(req.user, req.params.id, d, note);
    await audit({
      actor: req.user._id,
      action: `leave.${d.toLowerCase()}`,
      entityType: 'LeaveRequest',
      entityId: req.params.id,
    });
    res.json(ok({ request }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function cancel(req, res, next) {
  try {
    const request = await svc.cancelLeave(req.user, req.params.id);
    await audit({ actor: req.user._id, action: 'leave.cancel', entityType: 'LeaveRequest', entityId: req.params.id });
    res.json(ok({ request }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function remove(req, res, next) {
  try {
    await svc.deleteLeave(req.user, req.params.id);
    await audit({ actor: req.user._id, action: 'leave.delete', entityType: 'LeaveRequest', entityId: req.params.id });
    res.json(ok({ success: true }));
  } catch (err) {
    handleErr(res, err, next);
  }
}
