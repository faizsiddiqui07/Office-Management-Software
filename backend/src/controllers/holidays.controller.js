import { ok, fail } from '../lib/apiResponse.js';
import {
  createHolidaySchema,
  updateHolidaySchema,
  listHolidaysQuerySchema,
} from '../validators/holidays.validators.js';
import * as svc from '../services/holiday.service.js';
import { renderHolidayListToStream } from '../services/reportPdf.service.js';
import { loadCompanyLogo } from '../lib/brand.js';
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

/**
 * A printable one-page annual holiday list for the notice board. Calendar year (?year=,
 * default this year). Public holidays always; optional holidays included unless
 * ?optional=false, events only with ?events=true. Everyone can pull it — the calendar
 * itself is visible to all. Mirrors leaveLedger's binary-PDF response.
 */
export async function listPdf(req, res, next) {
  try {
    const y = Number(req.query.year);
    const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear();
    const optional = req.query.optional !== 'false' && req.query.optional !== '0'; // default on
    const events = req.query.events === 'true' || req.query.events === '1'; // default off

    const data = await svc.buildHolidayList(year, { optional, events });
    await audit({ actor: req.user._id, action: 'holiday.list_download', entityType: 'Holiday', entityId: String(year), meta: { optional, events, count: data.rows.length } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="holiday-list-${year}.pdf"`);
    const stream = await renderHolidayListToStream(data, loadCompanyLogo(data.company.logoDark || data.company.logoUrl || data.company.logoLight));
    stream.on('error', (err) => next(err));
    stream.pipe(res);
    return undefined;
  } catch (err) {
    return handleErr(res, err, next);
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
