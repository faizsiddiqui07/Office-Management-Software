import { ok, fail } from '../lib/apiResponse.js';
import {
  createHolidaySchema,
  updateHolidaySchema,
  listHolidaysQuerySchema,
} from '../validators/holidays.validators.js';
import * as svc from '../services/holiday.service.js';
import { audit } from '../models/AuditLog.js';

function handleErr(res, err, next) {
  if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
  return next(err);
}

export async function list(req, res, next) {
  try {
    const q = listHolidaysQuerySchema.parse(req.query);
    res.json(ok({ holidays: await svc.listHolidays(q) }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function create(req, res, next) {
  try {
    const body = createHolidaySchema.parse(req.body);
    const holiday = await svc.createHoliday(req.user, body);
    await audit({ actor: req.user._id, action: 'holiday.create', entityType: 'Holiday', entityId: holiday.id, meta: { type: holiday.type } });
    res.status(201).json(ok({ holiday }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function update(req, res, next) {
  try {
    const body = updateHolidaySchema.parse(req.body);
    const holiday = await svc.updateHoliday(req.params.id, body);
    await audit({ actor: req.user._id, action: 'holiday.update', entityType: 'Holiday', entityId: req.params.id });
    res.json(ok({ holiday }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function remove(req, res, next) {
  try {
    await svc.deleteHoliday(req.params.id);
    await audit({ actor: req.user._id, action: 'holiday.delete', entityType: 'Holiday', entityId: req.params.id });
    res.json(ok({ success: true }));
  } catch (err) {
    handleErr(res, err, next);
  }
}
