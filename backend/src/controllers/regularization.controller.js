import { ok, fail } from '../lib/apiResponse.js';
import * as svc from '../services/regularization.service.js';
import { createRegSchema, decideRegSchema } from '../validators/regularization.validators.js';
import { audit } from '../models/AuditLog.js';

function handleErr(res, err, next) {
  if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
  return next(err);
}

export async function myRequests(req, res, next) {
  try {
    res.json(ok({ requests: await svc.listForUser(req.user._id) }));
  } catch (err) {
    next(err);
  }
}

export async function pending(req, res, next) {
  try {
    res.json(ok({ requests: await svc.listPending() }));
  } catch (err) {
    next(err);
  }
}

export async function history(req, res, next) {
  try {
    res.json(ok({ requests: await svc.listHistory() }));
  } catch (err) {
    next(err);
  }
}

export async function remove(req, res, next) {
  try {
    await svc.remove(req.params.id);
    await audit({ actor: req.user._id, action: 'regularization.delete', entityType: 'Regularization', entityId: req.params.id });
    res.json(ok({ deleted: true }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function create(req, res, next) {
  try {
    const body = createRegSchema.parse(req.body);
    const reg = await svc.createRequest(req.user, body);
    await audit({ actor: req.user._id, action: 'regularization.create', entityType: 'Regularization', entityId: reg.id, meta: { dateYMD: body.dateYMD } });
    res.status(201).json(ok({ request: reg }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function decide(req, res, next) {
  try {
    const { decision, note } = decideRegSchema.parse(req.body);
    const reg = await svc.decide(req.user, req.params.id, decision, note);
    await audit({ actor: req.user._id, action: `regularization.${decision.toLowerCase()}`, entityType: 'Regularization', entityId: req.params.id });
    res.json(ok({ request: reg }));
  } catch (err) {
    handleErr(res, err, next);
  }
}
