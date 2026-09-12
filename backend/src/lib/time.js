import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * Company timezone helpers. Timestamps are stored in UTC and presented in the
 * company timezone. Used for attendance day boundaries, late/overtime math, and
 * reports.
 */
export const COMPANY_TZ = process.env.COMPANY_TZ || 'Asia/Kolkata';

export function nowInCompanyTz() {
  return toZonedTime(new Date(), COMPANY_TZ);
}
export function toCompanyTz(date) {
  return toZonedTime(date, COMPANY_TZ);
}
export function fromCompanyTz(date) {
  return fromZonedTime(date, COMPANY_TZ);
}
export function formatCompany(date, fmt = 'yyyy-MM-dd HH:mm:ss') {
  return formatInTimeZone(date, COMPANY_TZ, fmt);
}

/** yyyy-MM-dd for an instant, in the company timezone. */
export function ymdInTz(date = new Date()) {
  return formatInTimeZone(date, COMPANY_TZ, 'yyyy-MM-dd');
}

/** Company-TZ midnight (UTC instant) for an instant — the canonical Attendance.date. */
export function companyTzMidnight(date = new Date()) {
  return fromZonedTime(`${ymdInTz(date)}T00:00:00`, COMPANY_TZ);
}

/** Canonical day instant from a yyyy-MM-dd string. */
export function companyDayFromYMD(ymd) {
  return fromZonedTime(`${ymd}T00:00:00`, COMPANY_TZ);
}

/** UTC instant for an HH:mm wall-clock time on the company day of `dayInstant`. */
export function companyDayInstantAt(dayInstant, hm) {
  const ymd = formatInTimeZone(dayInstant, COMPANY_TZ, 'yyyy-MM-dd');
  return fromZonedTime(`${ymd}T${hm}:00`, COMPANY_TZ);
}

/** 0 (Sun) – 6 (Sat) day-of-week of the company day. */
export function dayOfWeekInTz(dayInstant) {
  return toZonedTime(dayInstant, COMPANY_TZ).getDay();
}

/** Late if check-in is after workStart + grace. */
export function isLateCheckIn(checkInAt, dayInstant, workStart, graceMinutes = 0) {
  const workStartAt = companyDayInstantAt(dayInstant, workStart);
  const threshold = new Date(workStartAt.getTime() + graceMinutes * 60000);
  return checkInAt.getTime() > threshold.getTime();
}

/**
 * How many whole minutes AFTER the grace period somebody checked in. 0 when they were on
 * time or inside the grace — the grace is forgiven entirely, not counted from the shift
 * start. Rounded to the minute the same way workedMinutes is, so a check-in a few seconds
 * past the grace reads as 0 here even though isLateCheckIn (a strict instant compare)
 * already calls the day late: the -1 late mark applies, the overtime clock does not move.
 */
export function lateMinutesBeyondGrace(checkInAt, dayInstant, workStart, graceMinutes = 0) {
  const threshold = companyDayInstantAt(dayInstant, workStart).getTime() + Math.max(0, graceMinutes) * 60000;
  return Math.max(0, Math.round((checkInAt.getTime() - threshold) / 60000));
}

/**
 * Worked + overtime minutes for a completed day.
 * Overtime = time worked past (workEnd + `overtimeAfterMinutes` + `lateShiftMinutes`).
 *
 * The buffer is the office's "overtime only counts N minutes after your shift ends"
 * setting — e.g. shift ends 6 PM and a 60-minute buffer means overtime is only the time
 * past 7 PM. 0 = counts from the shift end itself.
 *
 * `lateShiftMinutes` (owner's rule, 12 Sep 2026) pushes that threshold back by however
 * late the person was beyond their grace. Two people leaving at 7:30 used to earn the same
 * overtime whether they had arrived at 10:05 or 10:35; now the one who arrived twenty
 * minutes past grace starts their overtime twenty minutes later. The caller decides
 * whether the day qualifies (a late that was excused, a half-day, a day before the rule
 * began — all pass 0). workedMinutes is the full clocked time and never touched by either.
 */
export function computeWork(checkInAt, checkOutAt, dayInstant, workEnd, overtimeAfterMinutes = 0, lateShiftMinutes = 0) {
  const workEndAt = companyDayInstantAt(dayInstant, workEnd);
  const otThreshold = new Date(workEndAt.getTime() + (Math.max(0, overtimeAfterMinutes) + Math.max(0, lateShiftMinutes)) * 60000);
  const workedMinutes = Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000));
  const overtimeMinutes = Math.max(0, Math.round((checkOutAt.getTime() - otThreshold.getTime()) / 60000));
  return { workedMinutes, overtimeMinutes };
}
