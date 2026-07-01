import { formatInTimeZone } from 'date-fns-tz';
import { Attendance } from '../models/Attendance.js';
import { Setting } from '../models/Setting.js';
import { LeaveBalance } from '../models/LeaveBalance.js';
import { User } from '../models/User.js';
import { canViewEveryone, can } from '../lib/permissions.js';
import { haversineMeters } from '../lib/geo.js';
import { holidayYMDSet } from './holiday.service.js';
import {
  COMPANY_TZ,
  companyTzMidnight,
  companyDayFromYMD,
  companyDayInstantAt,
  dayOfWeekInTz,
  ymdInTz,
  isLateCheckIn,
  computeWork,
} from '../lib/time.js';

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
  const isLate = isLateCheckIn(now, day, settings.workStart, settings.graceMinutes);
  const status = isLate ? 'LATE' : 'PRESENT';
  const reason = isLate ? cleanLateReason(lateReason) : null; // reason only meaningful when late

  const set = { checkInAt: now, status, checkInMeta: { ...meta, ...geoMeta } };
  const update = reason ? { $set: { ...set, lateReason: reason } } : { $set: set, $unset: { lateReason: '' } };

  const record = await Attendance.findOneAndUpdate(
    { user: user._id, date: day },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return record;
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
  const { workedMinutes, overtimeMinutes } = computeWork(record.checkInAt, now, day, settings.workEnd);

  record.checkOutAt = now;
  record.checkOutMeta = { ...meta, ...geoMeta };
  record.workedMinutes = workedMinutes;
  record.overtimeMinutes = overtimeMinutes;
  await record.save();

  // Accrue overtime into the user's yearly leave balance.
  if (overtimeMinutes > 0) {
    const year = Number(formatInTimeZone(day, COMPANY_TZ, 'yyyy'));
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

  return {
    record: record ? record.toJSON() : null,
    serverNow: now.toISOString(),
    isHoliday,
    workStartAt: companyDayInstantAt(day, settings.workStart).toISOString(),
    workEndAt: companyDayInstantAt(day, settings.workEnd).toISOString(),
    settings: {
      workStart: settings.workStart,
      workEnd: settings.workEnd,
      graceMinutes: settings.graceMinutes,
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
 * "Everyone for a date" — every active user with their record (or ABSENT/HOLIDAY
 * when none). ON_LEAVE / holiday-calendar sources wire in once Phases 4 & 6 land.
 */
export async function attendanceOverview(ymd) {
  const day = ymd ? companyDayFromYMD(ymd) : companyTzMidnight(new Date());
  const settings = await Setting.getSingleton();
  const isWeekend = settings.weekendDays.includes(dayOfWeekInTz(day));
  const dateYMD = ymdInTz(day);
  const isHoliday = (await holidayYMDSet(dateYMD, dateYMD)).has(dateYMD);

  const [allUsers, records] = await Promise.all([
    User.find({ isActive: true }).select('name email role employeeId department').sort({ name: 1 }),
    Attendance.find({ date: day }),
  ]);

  // Only people who actually mark attendance belong in the roster. Roles without
  // `markAttendance` (e.g. CEO/leadership who don't self-track) are never counted
  // present/absent — they simply aren't part of the daily attendance view.
  const users = allUsers.filter((u) => can({ role: u.role }, 'markAttendance'));

  const byUser = new Map(records.map((r) => [String(r.user), r]));
  const rows = users.map((u) => {
    const rec = byUser.get(String(u._id)) || null;
    let status = rec?.status;
    if (!status) status = isWeekend || isHoliday ? 'HOLIDAY' : 'ABSENT';
    return { user: u.toJSON(), attendance: rec ? rec.toJSON() : null, status };
  });

  const summary = {
    total: rows.length,
    present: rows.filter((r) => r.status === 'PRESENT').length,
    late: rows.filter((r) => r.status === 'LATE').length,
    excused: rows.filter((r) => r.status === 'LATE' && r.attendance?.excused).length,
    absent: rows.filter((r) => r.status === 'ABSENT').length,
    onLeave: rows.filter((r) => r.status === 'ON_LEAVE').length,
  };

  return { date: ymdInTz(day), isWeekend, isHoliday, rows, summary };
}
