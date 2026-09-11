/**
 * When does a repeating announcement fall due? Pure date arithmetic, no DB, no clock —
 * everything here takes the day as a 'YYYY-MM-DD' string so it can be tested against
 * any calendar and never depends on the machine's timezone.
 *
 * A rule is { type, weekday, dayOfMonth, month, time }:
 *   WEEKLY   — every `weekday` (0 = Sunday … 6 = Saturday)
 *   MONTHLY  — every month on `dayOfMonth`
 *   YEARLY   — every year on `month`/`dayOfMonth`
 *   NONE     — doesn't repeat
 * `time` is 'HH:mm' in the company's timezone: the moment on that day it goes out.
 *
 * THE CLAMP RULE, because it is the part people get wrong: "the 31st of every month" has
 * to mean something in April, and "29 February every year" has to mean something in
 * 2027. Both are read as "the last such day that exists" — the 30th of April, the 28th
 * of February — rather than silently skipping the month or the year. Skipping is what a
 * naive day === dayOfMonth check does, and a reminder that quietly misses every second
 * month is worse than no reminder.
 */

export const RECURRENCE_TYPES = ['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY'];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const isYMD = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const parts = (ymd) => ymd.split('-').map(Number); // [y, m, d]
const pad = (n) => String(n).padStart(2, '0');
const toYMD = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Days in a month, leap years included. m is 1-12. */
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday, for a plain date, without touching local time. */
export function weekdayOf(ymd) {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

/** The day after, as a plain date. */
export function nextDay(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Is this a usable rule? Missing parts for the chosen type make it invalid, not NONE. */
export function isValidRule(rule) {
  if (!rule || !RECURRENCE_TYPES.includes(rule.type)) return false;
  if (rule.time !== undefined && rule.time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(rule.time))) return false;
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  switch (rule.type) {
    case 'NONE': return true;
    case 'WEEKLY': return int(rule.weekday, 0, 6);
    case 'MONTHLY': return int(rule.dayOfMonth, 1, 31);
    case 'YEARLY': return int(rule.month, 1, 12) && int(rule.dayOfMonth, 1, 31);
    default: return false;
  }
}

/** Does this plain date fall on the rule? Clamped, as described above. */
export function matchesYMD(rule, ymd) {
  if (!isValidRule(rule) || rule.type === 'NONE' || !isYMD(ymd)) return false;
  const [y, m, d] = parts(ymd);
  switch (rule.type) {
    case 'WEEKLY':
      return weekdayOf(ymd) === rule.weekday;
    case 'MONTHLY':
      return d === Math.min(rule.dayOfMonth, daysInMonth(y, m));
    case 'YEARLY':
      return m === rule.month && d === Math.min(rule.dayOfMonth, daysInMonth(y, m));
    default:
      return false;
  }
}

/**
 * The first day on or after `fromYMD` the rule falls on, or null for a rule that never
 * does. Bounded: a yearly rule is at most 366 days away, so the walk stops there.
 */
export function nextOccurrenceYMD(rule, fromYMD) {
  if (!isValidRule(rule) || rule.type === 'NONE' || !isYMD(fromYMD)) return null;
  let cur = fromYMD;
  for (let i = 0; i <= 366; i += 1) {
    if (matchesYMD(rule, cur)) return cur;
    cur = nextDay(cur);
  }
  return null;
}

/** The day before, as a plain date. */
export function prevDay(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The most recent day on or before `ymd` the rule falls on, looking back at most
 * `maxBack` days (null if none in that window). This is what lets a scanner CATCH UP:
 * an occurrence whose time fell in the gap between two ticks — 23:58 with ticks at
 * 23:55 and 00:00 — is found on the next tick rather than lost, and the window keeps a
 * scanner that was down for a week from announcing seven stale reminders on Monday.
 */
export function lastOccurrenceOnOrBefore(rule, ymd, maxBack = 1) {
  if (!isValidRule(rule) || rule.type === 'NONE' || !isYMD(ymd)) return null;
  let cur = ymd;
  for (let i = 0; i <= maxBack; i += 1) {
    if (matchesYMD(rule, cur)) return cur;
    cur = prevDay(cur);
  }
  return null;
}

/** "Every Saturday at 09:00" — one line a person can read back. */
export function describeRule(rule) {
  if (!isValidRule(rule) || rule.type === 'NONE') return '';
  const at = rule.time ? ` at ${rule.time}` : '';
  const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
  };
  switch (rule.type) {
    case 'WEEKLY': return `Every ${WEEKDAYS[rule.weekday]}${at}`;
    case 'MONTHLY': return `Every month on the ${ordinal(rule.dayOfMonth)}${at}`;
    case 'YEARLY': return `Every year on ${rule.dayOfMonth} ${MONTHS[rule.month - 1]}${at}`;
    default: return '';
  }
}

/** Strip a rule down to the fields its type actually uses, so stale ones never linger. */
export function normalizeRule(rule) {
  const type = RECURRENCE_TYPES.includes(rule?.type) ? rule.type : 'NONE';
  const time = rule?.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(rule.time) ? rule.time : '09:00';
  const out = { type, weekday: null, dayOfMonth: null, month: null, time };
  if (type === 'WEEKLY') out.weekday = rule.weekday;
  if (type === 'MONTHLY') out.dayOfMonth = rule.dayOfMonth;
  if (type === 'YEARLY') { out.month = rule.month; out.dayOfMonth = rule.dayOfMonth; }
  return out;
}

/** Minutes past midnight for 'HH:mm'. */
export function minutesOf(time) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
