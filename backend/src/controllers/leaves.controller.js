import { ok, fail } from '../lib/apiResponse.js';
import { can } from '../lib/permissions.js';
import { applyLeaveSchema, decisionSchema, listLeavesQuerySchema } from '../validators/leaves.validators.js';
import * as svc from '../services/leave.service.js';
import { audit } from '../models/AuditLog.js';

function handleErr(res, err, next) {
  if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
  return next(err);
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
