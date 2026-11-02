import { COMPANY_TZ } from './time';

export const PRIORITY = {
  NORMAL: { label: 'Normal', tone: 'info' },
  IMPORTANT: { label: 'Important', tone: 'warning' },
  URGENT: { label: 'Urgent', tone: 'destructive' },
};

export const PRIORITY_OPTIONS = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'IMPORTANT', label: 'Important' },
  { value: 'URGENT', label: 'Urgent' },
];

/**
 * The exact instant that a company-time date and clock-time name — '2026-10-12' at '09:00'
 * in the office's timezone, as an ISO string the server can store.
 *
 * Worked out from COMPANY_TZ rather than by bolting on a fixed +05:30, so the one place this
 * would ever need changing is that constant. The round trip finds how far the chosen zone sat
 * from UTC at that moment and shifts by it, which also stays right in a zone that observes DST.
 */
export function companyInstant(ymd, hhmm = '09:00') {
  if (!ymd) return null;
  const guess = new Date(`${ymd}T${hhmm || '09:00'}:00Z`);
  if (Number.isNaN(guess.getTime())) return null;
  const inZone = new Date(guess.toLocaleString('en-US', { timeZone: COMPANY_TZ }));
  const inUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (inZone.getTime() - inUtc.getTime())).toISOString();
}

/** An ISO instant back into the company-time { ymd, hhmm } a picker shows. */
export function companyParts(iso) {
  if (!iso) return { ymd: '', hhmm: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { ymd: '', hhmm: '' };
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TZ }).format(d);
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: COMPANY_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return { ymd, hhmm };
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: COMPANY_TZ,
    day: '2-digit',
    month: 'short',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: COMPANY_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${date}, ${time}`;
}

// ── Repeats ────────────────────────────────────────────────────────────────────
// Mirrors backend/src/lib/recurrence.js for DISPLAY only. The server decides when a
// post actually goes out; this just says the rule back in words.
//
// WORD FOR WORD with the server's describeRule, because that string is not only shown on
// a card: the API writes it into the activity log. Two wordings for one post would read
// as two different posts.
export const RECURRENCE_OPTIONS = [
  { value: 'NONE', label: 'Doesn’t repeat' },
  { value: 'WEEKLY', label: 'Every week' },
  { value: 'MONTHLY', label: 'Every month' },
  { value: 'YEARLY', label: 'Every year' },
  { value: 'DATES', label: 'On dates I pick' },
];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Keep in step with MAX_RULE_DATES in backend/src/lib/recurrence.js. If these two drift,
 *  the server quietly trims dates the dialog let somebody add. */
export const MAX_RULE_DATES = 24;

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/** '2026-11-05' → '5 Nov 2026'. Built by hand, exactly as the server builds it — not
 *  through Intl, whose output varies by machine and locale. */
export function formatDay(ymd) {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

const listOf = (items) => {
  if (!items.length) return '';
  if (items.length === 1) return String(items[0]);
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

// A rule's days, from the list if it has any and from the old single field otherwise —
// the same two shapes the server reads.
//
// Tested on `?.length`, NEVER on the key itself. A row saved before lists existed now
// comes back with `daysOfMonth: []` (mongoose fills the default on read), and `[]` is
// TRUTHY in JavaScript — so `r.daysOfMonth ? … : …` renders "Every month on the " with
// nothing after it on every older post.
const nums = (list) => [...new Set(list)].sort((a, b) => a - b);
const weekdaysOf = (r) => (r?.weekdays?.length ? nums(r.weekdays) : (r?.weekday != null ? [r.weekday] : []));
const monthDays = (r) => (r?.daysOfMonth?.length ? nums(r.daysOfMonth) : (r?.dayOfMonth != null ? [r.dayOfMonth] : []));
const ruleDates = (r) => (r?.dates?.length ? [...new Set(r.dates)].sort() : []);

/** "Every Saturday at 09:00" — empty for a post that doesn't repeat. */
export function describeRecurrence(r) {
  if (!r || !r.type || r.type === 'NONE') return '';
  const at = r.time ? ` at ${r.time}` : '';
  if (r.type === 'WEEKLY') {
    const ws = weekdaysOf(r);
    return ws.length ? `Every ${listOf(ws.map((w) => WEEKDAYS_LONG[w]))}${at}` : '';
  }
  if (r.type === 'MONTHLY') {
    const ds = monthDays(r);
    return ds.length ? `Every month on the ${listOf(ds.map(ordinal))}${at}` : '';
  }
  if (r.type === 'YEARLY') {
    const ds = monthDays(r);
    return r.month != null && ds.length ? `Every year on ${listOf(ds)} ${MONTHS[r.month - 1]}${at}` : '';
  }
  if (r.type === 'DATES') {
    const ds = ruleDates(r);
    if (!ds.length) return '';
    // Past three the full list stops being a sentence — and this sits in a chip on a phone.
    if (ds.length > 3) return `On ${ds.length} dates between ${formatDay(ds[0])} and ${formatDay(ds[ds.length - 1])}${at}`;
    return `On ${listOf(ds.map(formatDay))}${at}`;
  }
  return '';
}

/**
 * For a picked-dates post: how many days it names, and how many are still ahead.
 *
 * Only the card's wording uses this — once nothing is left, a "Repeat" chip is claiming
 * something that will not happen again. Kept OUT of describeRecurrence on purpose: that
 * one mirrors the server's string, and a string that changes with the clock cannot mirror
 * anything.
 */
export function datesLeft(r, todayYMD) {
  if (!r || r.type !== 'DATES') return null;
  const ds = ruleDates(r);
  if (!ds.length) return null;
  return { total: ds.length, left: ds.filter((d) => d >= todayYMD).length, lastYMD: ds[ds.length - 1] };
}
