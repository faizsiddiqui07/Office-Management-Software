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

/** Worked + overtime minutes for a completed day (overtime = time past workEnd). */
export function computeWork(checkInAt, checkOutAt, dayInstant, workEnd) {
  const workEndAt = companyDayInstantAt(dayInstant, workEnd);
  const workedMinutes = Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000));
  const overtimeMinutes = Math.max(0, Math.round((checkOutAt.getTime() - workEndAt.getTime()) / 60000));
  return { workedMinutes, overtimeMinutes };
}
