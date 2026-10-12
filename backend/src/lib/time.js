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
 * Off-day (chhutti ke din) par poora din overtime — owner ka niyam, 12 Oct 2026.
 *
 * Is tareekh se PEHLE ke din purana niyam hi rakhte hain, taaki koi baad ka recalculation
 * wo na badle jo pichhle mahine already diya ja chuka hai. Wahi vaada jo lateLadder.js
 * LATE_LADDER_FLOOR_YMD ke saath karta hai.
 */
export const OFFDAY_FULL_OT_FLOOR_YMD = '2026-10-01';

/**
 * Worked + overtime minutes for a completed day.
 *
 * Aam din: overtime = (workEnd + `overtimeAfterMinutes`) ke baad ka waqt. Buffer office ki
 * "shift khatam hone ke N minute baad se overtime ginna" wali setting hai — misaal, shift
 * 6 PM par khatam aur 60-minute buffer, to overtime sirf 7 PM ke baad ka. 0 = shift end se
 * hi. workedMinutes poora clocked time hai aur buffer use kabhi nahi chhuta.
 *
 * Off-day (`offDay = true`, aur din OFFDAY_FULL_OT_FLOOR_YMD se aage): poora din overtime —
 * check-in se check-out tak. Us din shift end ka koi matlab hi nahi, banda aane ke liye due
 * hi nahi tha. Owner ka faisla: hamesha poora span, `max(span, purana)` nahi — niyam Rules
 * page par ek line me likha ja sake.
 *
 * FLOOR KA CHECK YAHIN ANDAR HAI, caller me NAHI — aur ye is poore niyam ki sabse zaroori
 * baat hai. `recomputeAllOvertime` ka filter sirf "check-in aur check-out dono hain" hai,
 * usme koi date ki seema nahi, aur wo khud-ba-khud chalta hai: Settings me shift end badlo
 * ya kisi ka schedule edit karo. Floor bahar hota to deploy ke baad pehla hi Settings-save
 * July/August/September ke saare Sunday ko poora-din overtime de deta aur un band mahinon
 * ke points dobara likh deta. Yahan andar hone se har raasta — aur jo kal banega wo bhi —
 * apne aap surakshit hai, caller bhool bhi jaye to purana din nahi badlega.
 */
export function computeWork(checkInAt, checkOutAt, dayInstant, workEnd, overtimeAfterMinutes = 0, offDay = false) {
  const workEndAt = companyDayInstantAt(dayInstant, workEnd);
  const otThreshold = new Date(workEndAt.getTime() + Math.max(0, overtimeAfterMinutes) * 60000);
  const workedMinutes = Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000));
  const fullDay = !!offDay && ymdInTz(dayInstant) >= OFFDAY_FULL_OT_FLOOR_YMD;
  const overtimeMinutes = fullDay
    ? workedMinutes
    : Math.max(0, Math.round((checkOutAt.getTime() - otThreshold.getTime()) / 60000));
  return { workedMinutes, overtimeMinutes };
}
