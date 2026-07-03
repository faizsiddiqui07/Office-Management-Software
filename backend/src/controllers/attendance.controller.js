import { formatInTimeZone } from 'date-fns-tz';
import { ok, fail } from '../lib/apiResponse.js';
import { listQuerySchema, overviewQuerySchema } from '../validators/attendance.validators.js';
import * as svc from '../services/attendance.service.js';
import { audit } from '../models/AuditLog.js';
import { notifyCheckIn } from '../services/checkinAlert.service.js';
import { COMPANY_TZ } from '../lib/time.js';
import { toCsv } from '../lib/csv.js';

function reqMeta(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] || '' };
}

function reqCoords(req) {
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

function handleErr(res, err, next) {
  if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
  return next(err);
}

export async function checkIn(req, res, next) {
  try {
    const record = await svc.checkIn(req.user, reqMeta(req), reqCoords(req), req.body?.lateReason);
    await audit({ actor: req.user._id, action: 'attendance.check_in', entityType: 'Attendance', entityId: record.id });
    // Alert leadership in-app — fire-and-forget so it never delays/breaks check-in.
    notifyCheckIn(req.user, record).catch(() => {});
    res.status(201).json(ok({ record: record.toJSON() }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

/** Leadership: set/edit/clear a user's check-in & check-out for a given day. */
export async function setRecord(req, res, next) {
  try {
    const { userId, dateYMD } = req.body || {};
    const checkIn = req.body?.checkIn || '';
    const checkOut = req.body?.checkOut || '';
    const hm = /^\d{2}:\d{2}$/;
    if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(dateYMD || '')) {
      return res.status(400).json(fail('BAD_INPUT', 'userId and a valid date are required'));
    }
    if (checkIn && !hm.test(checkIn)) return res.status(400).json(fail('BAD_TIME', 'Invalid check-in time'));
    if (checkOut && !hm.test(checkOut)) return res.status(400).json(fail('BAD_TIME', 'Invalid check-out time'));
    if (checkIn && checkOut && checkOut <= checkIn) {
      return res.status(400).json(fail('BAD_RANGE', 'Check-out must be after check-in'));
    }
    const result = await svc.setAttendanceRecord(userId, dateYMD, checkIn, checkOut);
    await audit({
      actor: req.user._id,
      action: 'attendance.edit',
      entityType: 'Attendance',
      entityId: String(userId),
      meta: { dateYMD, checkIn, checkOut },
    });
    res.json(ok(result));
  } catch (err) {
    handleErr(res, err, next);
  }
}

/** Leadership: excuse (or un-excuse) a late check-in so it isn't counted against the person. */
export async function excuse(req, res, next) {
  try {
    const record = await svc.excuseLate(req.user, req.params.id, req.body?.excused);
    await audit({ actor: req.user._id, action: 'attendance.excuse', entityType: 'Attendance', entityId: record.id, meta: { excused: record.excused } });
    res.json(ok({ record: record.toJSON() }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function checkOut(req, res, next) {
  try {
    const record = await svc.checkOut(req.user, reqMeta(req), reqCoords(req));
    await audit({ actor: req.user._id, action: 'attendance.check_out', entityType: 'Attendance', entityId: record.id });
    res.json(ok({ record: record.toJSON() }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function today(req, res, next) {
  try {
    res.json(ok(await svc.getTodayPayload(req.user)));
  } catch (err) {
    next(err);
  }
}

export async function list(req, res, next) {
  try {
    const q = listQuerySchema.parse(req.query);
    const data = await svc.listAttendance(req.user, { ...q, all: q.all === 'true' });
    res.json(ok(data));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function exportCsv(req, res, next) {
  try {
    const q = listQuerySchema.parse(req.query);
    const { records } = await svc.listAttendance(req.user, { ...q, all: q.all === 'true', page: 1, limit: 5000 });
    const header = ['Date', 'Employee', 'Employee ID', 'Status', 'Check In', 'Check Out', 'Worked (min)', 'Overtime (min)'];
    const rows = records.map((r) => [
      formatInTimeZone(new Date(r.date), COMPANY_TZ, 'yyyy-MM-dd'),
      r.user?.name ?? '',
      r.user?.employeeId ?? '',
      r.status,
      r.checkInAt ? formatInTimeZone(new Date(r.checkInAt), COMPANY_TZ, 'HH:mm') : '',
      r.checkOutAt ? formatInTimeZone(new Date(r.checkOutAt), COMPANY_TZ, 'HH:mm') : '',
      r.workedMinutes ?? 0,
      r.overtimeMinutes ?? 0,
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
    res.send(toCsv(header, rows));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function overview(req, res, next) {
  try {
    const { date } = overviewQuerySchema.parse(req.query);
    res.json(ok(await svc.attendanceOverview(date)));
  } catch (err) {
    handleErr(res, err, next);
  }
}

/** Month payroll sheet: employee × day matrix + totals, as CSV. */
export async function matrixCsv(req, res, next) {
  try {
    const month = String(req.query.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json(fail('BAD_MONTH', 'Expected month=YYYY-MM'));
    const { days, rows } = await svc.attendanceMatrix(month);

    const header = [
      'Employee',
      'Employee ID',
      ...days.map((d) => d.slice(8)), // day-of-month columns
      'Present',
      'Late',
      'Absent',
      'On leave',
      'Worked (h)',
      'Overtime (h)',
    ];
    const body = rows.map((r) => [
      r.user.name,
      r.user.employeeId,
      ...r.cells,
      r.totals.present,
      r.totals.late,
      r.totals.absent,
      r.totals.onLeave,
      (r.totals.workedMinutes / 60).toFixed(1),
      (r.totals.overtimeMinutes / 60).toFixed(1),
    ]);
    // Legend row at the bottom so the sheet is self-explanatory.
    body.push([]);
    body.push(['Legend:', 'P present · L late · A absent · OL on leave · H weekend/holiday']);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${month}.csv"`);
    res.send(toCsv(header, body));
  } catch (err) {
    handleErr(res, err, next);
  }
}
