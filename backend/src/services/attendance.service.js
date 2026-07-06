import { Attendance } from '../models/Attendance.js';
import { Setting } from '../models/Setting.js';
import { LeaveBalance } from '../models/LeaveBalance.js';
import { User } from '../models/User.js';
import { canViewEveryone, can } from '../lib/permissions.js';
import { haversineMeters } from '../lib/geo.js';
import { holidayYMDSet } from './holiday.service.js';
import {
  companyTzMidnight,
  companyDayFromYMD,
  companyDayInstantAt,
  dayOfWeekInTz,
  ymdInTz,
  isLateCheckIn,
  computeWork,
} from '../lib/time.js';
import { effectiveSchedule, userWeekendDays, workWindowClosed } from '../lib/schedule.js';
import { leaveYearOf } from '../lib/leaveYear.js';
import { onCheckIn } from './bonus.service.js';

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/**
 * Enforces the office geo-fence (strict) when GPS attendance is enabled.
 * Returns the location bits to store in the attendance meta, or throws when the
 * user is outside the allowed radius / hasn't shared their location.
 */
function verifyGeofence(gps, coords) {
  const enabled = gps?.enabled && gps.latitude != null && gps.longitude != null;
  const hasCoords = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng);
  if (!enabled) {
    return hasCoords ? { lat: coords.lat, lng: coords.lng } : {};
  }
  if (!hasCoords) {
    throw httpError(400, 'LOCATION_REQUIRED', 'Location access is required for attendance. Please allow location and try again.');
  }
  const distance = haversineMeters(coords.lat, coords.lng, gps.latitude, gps.longitude);
  const radius = gps.radiusMeters || 200;
  if (distance > radius) {
    throw httpError(403, 'OUTSIDE_OFFICE', `You're about ${distance}m from the office (allowed ${radius}m). Attendance can only be marked at the office.`);
  }
  return { lat: coords.lat, lng: coords.lng, distance };
}

/** Keep only a sane reason payload (category + short note). */
function cleanLateReason(lateReason) {
  if (!lateReason || typeof lateReason !== 'object') return null;
  const category = String(lateReason.category || '').trim().slice(0, 40);
  const note = String(lateReason.note || '').trim().slice(0, 300);
  if (!category && !note) return null;
  return { category, note };
}

export async function checkIn(user, meta, coords, lateReason) {
  const now = new Date();
  const day = companyTzMidnight(now);
  const settings = await Setting.getSingleton();

  const existing = await Attendance.findOne({ user: user._id, date: day });
  if (existing && existing.checkInAt) {
    throw httpError(409, 'ALREADY_CHECKED_IN', 'You have already checked in today');
  }

  const geoMeta = verifyGeofence(settings.gpsAttendance, coords);
  const sched = effectiveSchedule(user, settings); // part-time uses its own hours
  const isLate = isLateCheckIn(now, day, sched.workStart, sched.graceMinutes);
  const status = isLate ? 'LATE' : 'PRESENT';
  const reason = isLate ? cleanLateReason(lateReason) : null; // reason only meaningful when late

  const set = { checkInAt: now, status, checkInMeta: { ...meta, ...geoMeta } };
  const update = reason ? { $set: { ...set, lateReason: reason } } : { $set: set, $unset: { lateReason: '' } };

  const record = await Attendance.findOneAndUpdate(
    { user: user._id, date: day },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Bonus: an on-time check-in may complete a punctual streak (best-effort).
  if (!isLate) {
    try { await onCheckIn(user, ymdInTz(day)); } catch (e) { console.error('bonus streak hook failed', e?.message); }
  }
  return record;
}

/**
 * Leadership sets/edits a user's check-in and/or check-out for a given day —
 * for any date, past or present. Recomputes late/worked/overtime against that
 * user's effective schedule. Both times blank clears the record (→ absent).
 */
export async function setAttendanceRecord(userId, dateYMD, checkIn, checkOut) {
  const user = await User.findById(userId).select('employmentType schedule');
  if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');
  const settings = await Setting.getSingleton();
  const sched = effectiveSchedule(user, settings);
  const day = companyDayFromYMD(dateYMD);

  let record = await Attendance.findOne({ user: userId, date: day });

  if (record && record.status === 'ON_LEAVE') {
    throw httpError(409, 'ON_LEAVE', 'This day is marked on leave — cancel the leave first to edit attendance');
  }

  // No times → clear the day (becomes absent).
  if (!checkIn && !checkOut) {
    if (record) await record.deleteOne();
    return { cleared: true, dateYMD };
  }

  if (!record) record = new Attendance({ user: userId, date: day });

  if (checkIn) {
    const inAt = companyDayInstantAt(day, checkIn);
    record.checkInAt = inAt;
    record.status = isLateCheckIn(inAt, day, sched.workStart, sched.graceMinutes) ? 'LATE' : 'PRESENT';
  } else {
    record.checkInAt = null;
    record.status = 'ABSENT';
  }
  record.checkOutAt = checkOut ? companyDayInstantAt(day, checkOut) : null;

  if (record.checkInAt && record.checkOutAt) {
    const { workedMinutes, overtimeMinutes } = computeWork(record.checkInAt, record.checkOutAt, day, sched.workEnd);
    record.workedMinutes = workedMinutes;
    record.overtimeMinutes = overtimeMinutes;
  } else {
    record.workedMinutes = 0;
    record.overtimeMinutes = 0;
  }

  await record.save();
  return record.toJSON();
}

/** Leadership marks a LATE record as excused (on-duty) — or un-excuses it. */
export async function excuseLate(approver, attendanceId, excused) {
  const record = await Attendance.findById(attendanceId);
  if (!record) throw httpError(404, 'NOT_FOUND', 'Attendance record not found');
  record.excused = excused !== false;
  record.excusedBy = record.excused ? approver._id : null;
  record.excusedAt = record.excused ? new Date() : null;
  await record.save();
  return record;
}

export async function checkOut(user, meta, coords) {
  const now = new Date();
  const day = companyTzMidnight(now);

  const record = await Attendance.findOne({ user: user._id, date: day });
  if (!record || !record.checkInAt) {
    throw httpError(409, 'NOT_CHECKED_IN', 'You need to check in before checking out');
  }
  if (record.checkOutAt) {
    throw httpError(409, 'ALREADY_CHECKED_OUT', 'You have already checked out today');
  }

  const settings = await Setting.getSingleton();
  const geoMeta = verifyGeofence(settings.gpsAttendance, coords);
  const sched = effectiveSchedule(user, settings); // part-time overtime counts past its own end
  const { workedMinutes, overtimeMinutes } = computeWork(record.checkInAt, now, day, sched.workEnd);

  record.checkOutAt = now;
  record.checkOutMeta = { ...meta, ...geoMeta };
  record.workedMinutes = workedMinutes;
  record.overtimeMinutes = overtimeMinutes;
  await record.save();

  // Accrue overtime into the user's yearly leave balance.
  if (overtimeMinutes > 0) {
    const year = leaveYearOf(ymdInTz(day)); // fiscal leave year — same balance as leave
    await LeaveBalance.findOneAndUpdate(
      { user: user._id, year },
      {
        $inc: { overtimeMinutes },
        $setOnInsert: {
          user: user._id,
          year,
          totalQuota: settings.annualLeaveQuota,
          used: 0,
          remaining: settings.annualLeaveQuota,
        },
      },
      { upsert: true },
    );
  }

  return record;
}

/** Payload for the live check-in/out card (own record + the day's work-window instants). */
export async function getTodayPayload(user) {
  const now = new Date();
  const day = companyTzMidnight(now);
  const settings = await Setting.getSingleton();
  const record = await Attendance.findOne({ user: user._id, date: day });
  const dateYMD = ymdInTz(day);
  const isHoliday = (await holidayYMDSet(dateYMD, dateYMD)).has(dateYMD);
  const sched = effectiveSchedule(user, settings); // part-time uses its own hours

  return {
    record: record ? record.toJSON() : null,
    serverNow: now.toISOString(),
    isHoliday,
    employmentType: user.employmentType || 'FULL_TIME',
    workStartAt: companyDayInstantAt(day, sched.workStart).toISOString(),
    workEndAt: companyDayInstantAt(day, sched.workEnd).toISOString(),
    settings: {
      workStart: sched.workStart,
      workEnd: sched.workEnd,
      graceMinutes: sched.graceMinutes,
      timezone: settings.timezone,
    },
    gps: {
      enabled: !!(
        settings.gpsAttendance?.enabled &&
        settings.gpsAttendance?.latitude != null &&
        settings.gpsAttendance?.longitude != null
      ),
      radiusMeters: settings.gpsAttendance?.radiusMeters ?? 200,
    },
  };
}

export async function listAttendance(viewer, { userId, all, from, to, page = 1, limit = 31 }) {
  const everyone = canViewEveryone(viewer.role);
  const filter = {};

  if (all && everyone) {
    // no user filter — everyone's records
  } else if (userId) {
    if (!everyone && String(userId) !== String(viewer._id)) {
      throw httpError(403, 'FORBIDDEN', 'You are not allowed to view that user');
    }
    filter.user = userId;
  } else {
    filter.user = viewer._id; // privacy default — own records only
  }

  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = companyDayFromYMD(from);
    if (to) filter.date.$lte = companyDayFromYMD(to);
  }

  const skip = (page - 1) * limit;
  const [records, total] = await Promise.all([
    Attendance.find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'name employeeId role department'),
    Attendance.countDocuments(filter),
  ]);

  return { records: records.map((r) => r.toJSON()), total, page, limit };
}

/**
 * Month payroll matrix: every attendance-tracking employee × every day of the
 * month, with per-employee totals. Cell codes: P present, L late (unexcused —
 * excused counts as P), A absent, OL on leave, H weekend/holiday, '' future.
 */
export async function attendanceMatrix(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${monthKey}-01`;
  const to = `${monthKey}-${String(lastDay).padStart(2, '0')}`;

  const settings = await Setting.getSingleton();
  const holidays = await holidayYMDSet(from, to);
  const now = new Date();

  const allUsers = await User.find({ isActive: true }).select('name employeeId role employmentType schedule').sort({ name: 1 });
  const users = allUsers.filter((u) => can({ role: u.role }, 'markAttendance'));
  const records = await Attendance.find({
    date: { $gte: companyDayFromYMD(from), $lte: companyDayFromYMD(to) },
  });
  const byUserDay = new Map(records.map((r) => [`${r.user}|${ymdInTz(r.date)}`, r]));

  const days = [];
  for (let d = 1; d <= lastDay; d += 1) days.push(`${monthKey}-${String(d).padStart(2, '0')}`);
  const dowOf = new Map(days.map((ymd) => [ymd, dayOfWeekInTz(companyDayFromYMD(ymd))]));

  const rows = users.map((u) => {
    const offDays = userWeekendDays(u, settings); // this employee's non-working weekdays
    const t = { present: 0, late: 0, absent: 0, onLeave: 0, workedMinutes: 0, overtimeMinutes: 0 };
    const cells = days.map((ymd) => {
      const rec = byUserDay.get(`${u._id}|${ymd}`);
      const isOff = offDays.includes(dowOf.get(ymd)) || holidays.has(ymd);
      if (rec?.checkInAt) {
        t.workedMinutes += rec.workedMinutes || 0;
        t.overtimeMinutes += rec.overtimeMinutes || 0;
        t.present += 1;
        if (rec.status === 'LATE' && !rec.excused) {
          t.late += 1;
          return 'L';
        }
        return 'P';
      }
      if (rec?.status === 'ON_LEAVE') {
        t.onLeave += 1;
        return 'OL';
      }
      if (isOff) return 'H';
      // Future days, and today before the person's office day is over, aren't
      // absent yet — leave the cell blank until the window closes.
      if (!workWindowClosed(u, ymd, settings, now)) return '';
      t.absent += 1;
      return 'A';
    });
    return { user: u.toJSON(), cells, totals: t };
  });

  return { monthKey, days, rows };
}

/**
 * "Everyone for a date" — every active user with their record (or ABSENT/HOLIDAY
 * when none). ON_LEAVE / holiday-calendar sources wire in once Phases 4 & 6 land.
 */
export async function attendanceOverview(ymd) {
  const day = ymd ? companyDayFromYMD(ymd) : companyTzMidnight(new Date());
  const settings = await Setting.getSingleton();
  const dow = dayOfWeekInTz(day);
  const isWeekend = settings.weekendDays.includes(dow);
  const dateYMD = ymdInTz(day);
  const isHoliday = (await holidayYMDSet(dateYMD, dateYMD)).has(dateYMD);

  const [allUsers, records] = await Promise.all([
    User.find({ isActive: true }).select('name email role employeeId department employmentType schedule').sort({ name: 1 }),
    Attendance.find({ date: day }),
  ]);

  // Only people who actually mark attendance belong in the roster. Roles without
  // `markAttendance` (e.g. CEO/leadership who don't self-track) are never counted
  // present/absent — they simply aren't part of the daily attendance view.
  const users = allUsers.filter((u) => can({ role: u.role }, 'markAttendance'));

  const now = new Date();
  const byUser = new Map(records.map((r) => [String(r.user), r]));
  const rows = users.map((u) => {
    const rec = byUser.get(String(u._id)) || null;
    let status = rec?.status;
    if (!status) {
      // A part-timer's own off-day counts as a day off, not an absence.
      const off = isHoliday || userWeekendDays(u, settings).includes(dow);
      // A no-show is only "absent" once their office day is over — until then
      // they may still arrive, so they're "AWAITED" (shown as "—").
      if (off) status = 'HOLIDAY';
      else status = workWindowClosed(u, dateYMD, settings, now) ? 'ABSENT' : 'AWAITED';
    }
    return { user: u.toJSON(), attendance: rec ? rec.toJSON() : null, status };
  });

  const summary = {
    total: rows.length,
    present: rows.filter((r) => r.status === 'PRESENT').length,
    late: rows.filter((r) => r.status === 'LATE').length,
    excused: rows.filter((r) => r.status === 'LATE' && r.attendance?.excused).length,
    absent: rows.filter((r) => r.status === 'ABSENT').length,
    awaited: rows.filter((r) => r.status === 'AWAITED').length,
    onLeave: rows.filter((r) => r.status === 'ON_LEAVE').length,
  };

  return { date: ymdInTz(day), isWeekend, isHoliday, rows, summary };
}
