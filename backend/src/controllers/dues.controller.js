import { ok, fail } from '../lib/apiResponse.js';
import * as svc from '../services/dues.service.js';
import { addDueSchema, addPaymentSchema, settleSchema, settleEntrySchema } from '../validators/dues.validators.js';
import { audit } from '../models/AuditLog.js';
import { toCsv } from '../lib/csv.js';

function handleErr(res, err, next) {
  if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
  return next(err);
}

/** Any authenticated user — strictly their OWN ledger only. */
export async function myDues(req, res, next) {
  try {
    res.json(ok(await svc.ledgerFor(req.user._id)));
  } catch (err) {
    next(err);
  }
}

export async function overview(req, res, next) {
  try {
    res.json(ok(await svc.overview()));
  } catch (err) {
    next(err);
  }
}

export async function personDues(req, res, next) {
  try {
    res.json(ok(await svc.personLedger(req.params.id)));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function addDue(req, res, next) {
  try {
    const body = addDueSchema.parse(req.body);
    const result = await svc.createDue(req.user, body);
    await audit({ actor: req.user._id, action: 'dues.add', entityType: 'LedgerEntry', entityId: result.entry.id, meta: { person: body.person, amount: body.amount } });
    res.status(201).json(ok(result));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function addPayment(req, res, next) {
  try {
    const body = addPaymentSchema.parse(req.body);
    const result = await svc.createPayment(req.user, body);
    await audit({ actor: req.user._id, action: 'dues.payment', entityType: 'LedgerEntry', entityId: result.entry.id, meta: { person: body.person, amount: body.amount } });
    res.status(201).json(ok(result));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function settle(req, res, next) {
  try {
    const body = settleSchema.parse(req.body);
    const result = await svc.settle(req.user, body.person);
    await audit({ actor: req.user._id, action: 'dues.settle', entityType: 'User', entityId: body.person });
    res.json(ok(result));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function settleEntry(req, res, next) {
  try {
    const body = settleEntrySchema.parse(req.body);
    const result = await svc.settleDue(req.user, body.entryId);
    await audit({ actor: req.user._id, action: 'dues.settle_entry', entityType: 'LedgerEntry', entityId: body.entryId });
    res.json(ok(result));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function removeEntry(req, res, next) {
  try {
    const result = await svc.deleteEntry(req.params.id);
    await audit({ actor: req.user._id, action: 'dues.delete', entityType: 'LedgerEntry', entityId: req.params.id });
    res.json(ok(result));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function exportCsv(req, res, next) {
  try {
    const { header, rows } = await svc.exportRows();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="dues.csv"');
    res.send(toCsv(header, rows));
  } catch (err) {
    next(err);
  }
}
