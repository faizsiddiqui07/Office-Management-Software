/**
 * When does a repeating announcement fall due? Pure date arithmetic, no DB, no clock —
 * everything here takes the day as a 'YYYY-MM-DD' string so it can be tested against
 * any calendar and never depends on the machine's timezone.
 *
 * A rule is { type, weekdays, daysOfMonth, month, dates, time }:
 *   WEEKLY   — every one of `weekdays` (0 = Sunday … 6 = Saturday)
 *   MONTHLY  — every month, on every one of `daysOfMonth`
 *   YEARLY   — every year, in `month`, on every one of `daysOfMonth`
 *   DATES    — only on the calendar days listed in `dates`, then finished
 *   NONE     — doesn't repeat
 * `time` is 'HH:mm' in the company's timezone: the moment on those days it goes out.
 *
 * THE LISTS (owner's rule, 2 Nov 2026). The first three types each used to carry ONE day —
 * `weekday`, `dayOfMonth`. Those fields are still read, because rows written before this
 * hold nothing else, but nothing writes them any more: `normalizeRule` migrates a single
 * day into its list and leaves the old field null. Read a rule through `weekdaysOf` /
 * `monthDays` / `ruleDates` and both shapes answer the same, which is the only reason a
 * post made last month and a post made today behave alike.
 *
 * Deliberately NOT a mirror: writing `dayOfMonth = min(daysOfMonth)` for the benefit of
 * older readers was tried on paper and is worse than useless. An older validator ACCEPTS a
 * payload carrying both and stores only the single day — 201 Created, no error, a post that
 * goes out on one date instead of three, with a card confidently reading "Every month on the
 * 1st". A loud failure is worth more than a quiet wrong day.
 *
 * THE CLAMP RULE, because it is the part people get wrong: "the 31st of every month" has
 * to mean something in April, and "29 February every year" has to mean something in
 * 2027. Both are read as "the last such day that exists" — the 30th of April, the 28th
 * of February — rather than silently skipping the month or the year. Skipping is what a
 * naive day === dayOfMonth check does, and a reminder that quietly misses every second
 * month is worse than no reminder. With a LIST, the clamp applies to each picked day on
 * its own, so {28, 31} is one outing in February (both land on the 28th) and two in
 * March. That collapse is correct, and the dialog says so before anybody saves.
 *
 * The clamp does NOT apply to DATES. There the person named an exact day; "the nearest day
 * that exists" is a story about a repeating rule, not about a date somebody pointed at.
 */

export const RECURRENCE_TYPES = ['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY', 'DATES'];

/** Every type that re-announces. The scanner's query filters on this — see the warning
 *  on `announceRecurring`: a type missing from it looks completely fine and simply never
 *  fires again, with nothing in the logs. */
export const REPEATING_TYPES = RECURRENCE_TYPES.filter((t) => t !== 'NONE');

/** How many explicit dates one post may carry (owner's choice, 2 Nov 2026: two years of
 *  monthly). ONE constant, used by the validator, by normalizeRule and by the dialog — if
 *  those three ever disagree the server silently drops what the UI let somebody add. */
export const MAX_RULE_DATES = 24;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isYMD = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const parts = (ymd) => ymd.split('-').map(Number); // [y, m, d]
const pad = (n) => String(n).padStart(2, '0');
const toYMD = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Days in a month, leap years included. m is 1-12. */
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Is this a day that exists on the calendar? `isYMD` only checks the SHAPE, and
 * '2027-02-31' has the right shape — it would reach matchesYMD, never equal any real day,
 * and the post would sit there forever without ever going out. Picked dates come from a
 * person and must be real; the internal strings this file passes around (today, fromYMD)
 * already are, so `isYMD` stays as it is for those.
 */
export function isRealYMD(s) {
  if (!isYMD(s)) return false;
  const [y, m, d] = parts(s);
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
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

const sortedNums = (list) => [...new Set(list)].sort((a, b) => a - b);

// ── Reading a rule's days ──────────────────────────────────────────────────────
// Each of these returns a LIST, from the list field if it has anything and from the old
// single field otherwise. They deliberately do NOT drop rubbish: isValidRule has to be
// able to SEE a 1.5 or a '3' and refuse the rule. normalizeRule is where sanitising
// happens, on the way in.

/** Which weekdays a WEEKLY rule falls on. */
export function weekdaysOf(rule) {
  const list = Array.isArray(rule?.weekdays) ? rule.weekdays : [];
  if (list.length) return sortedNums(list);
  return rule?.weekday != null ? [rule.weekday] : [];
}

/** Which days of the month a MONTHLY or YEARLY rule falls on. */
export function monthDays(rule) {
  const list = Array.isArray(rule?.daysOfMonth) ? rule.daysOfMonth : [];
  if (list.length) return sortedNums(list);
  return rule?.dayOfMonth != null ? [rule.dayOfMonth] : [];
}

/** The calendar days a DATES rule names, in order. Lexicographic sort IS chronological
 *  for fixed-width 'YYYY-MM-DD'. */
export function ruleDates(rule) {
  const list = Array.isArray(rule?.dates) ? rule.dates : [];
  return [...new Set(list)].sort();
}

/** Is this a usable rule? Missing parts for the chosen type make it invalid, not NONE. */
export function isValidRule(rule) {
  if (!rule || !RECURRENCE_TYPES.includes(rule.type)) return false;
  if (rule.time !== undefined && rule.time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(rule.time))) return false;
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  switch (rule.type) {
    case 'NONE': return true;
    case 'WEEKLY': {
      const ws = weekdaysOf(rule);
      return ws.length > 0 && ws.every((w) => int(w, 0, 6));
    }
    case 'MONTHLY': {
      const ds = monthDays(rule);
      return ds.length > 0 && ds.every((d) => int(d, 1, 31));
    }
    case 'YEARLY': {
      const ds = monthDays(rule);
      return int(rule.month, 1, 12) && ds.length > 0 && ds.every((d) => int(d, 1, 31));
    }
    case 'DATES': {
      const ds = ruleDates(rule);
      return ds.length > 0 && ds.length <= MAX_RULE_DATES && ds.every(isRealYMD);
    }
    default: return false;
  }
}

/** Does this plain date fall on the rule? Clamped, as described above. */
export function matchesYMD(rule, ymd) {
  if (!isValidRule(rule) || rule.type === 'NONE' || !isYMD(ymd)) return false;
  const [y, m, d] = parts(ymd);
  switch (rule.type) {
    case 'WEEKLY':
      return weekdaysOf(rule).includes(weekdayOf(ymd));
    case 'MONTHLY': {
      const dim = daysInMonth(y, m);
      return monthDays(rule).some((day) => d === Math.min(day, dim));
    }
    case 'YEARLY': {
      if (m !== rule.month) return false;
      const dim = daysInMonth(y, m);
      return monthDays(rule).some((day) => d === Math.min(day, dim));
    }
    case 'DATES':
      return ruleDates(rule).includes(ymd);
    default:
      return false;
  }
}

/**
 * The first day on or after `fromYMD` the rule falls on, or null for a rule that never
 * does. The first three types are a bounded walk: a yearly rule is at most 366 days away,
 * so the walk stops there.
 *
 * DATES does NOT walk. Its days can be years out, and a walk that gives up after 366 days
 * would report a date in 2029 as "never" — which both callers read as a post with no first
 * outing. It answers from the list instead.
 *
 * NOTE, because two callers were written when it could not happen: null is now a possible
 * answer for a VALID rule — a DATES rule whose every day is in the past. Both call sites
 * turn that into a 400 rather than letting it reach the date maths (see
 * `firstOutingOrThrow` in announcement.service.js).
 */
export function nextOccurrenceYMD(rule, fromYMD) {
  if (!isValidRule(rule) || rule.type === 'NONE' || !isYMD(fromYMD)) return null;
  // Sorted on the way in: `.find` on the stored order would return the first day that is
  // merely >= fromYMD rather than the EARLIEST, and that wrong day is written to both
  // publishAt and the claim stamp — killing every listed date before it in one save.
  if (rule.type === 'DATES') return ruleDates(rule).find((d) => d >= fromYMD) || null;
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
 *
 * THE LIMIT OF THAT WINDOW, now that a rule can fall on consecutive days. This answers
 * with the NEWEST matching day, and `lastRecurredYMD` is a single high-water mark, so a
 * day that matched and was missed is overwritten the moment a later matching day goes out
 * — it cannot record "yesterday still pending, today done". Widening `maxBack` does not
 * help: 1, 2, 7 and 30 all give the same answer, because the loop stops at the first
 * match. The scanner narrows the hole from the other end (see `announceRecurring`), and
 * what is left is accepted and shown: `occurrences` records the days that really went out.
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

/** '2026-11-05' → '5 Nov 2026'. Built by hand rather than through Intl so the string is
 *  identical on every machine, and so the website can mirror it character for character. */
export function dayLabel(ymd) {
  if (!isYMD(ymd)) return '';
  const [y, m, d] = parts(ymd);
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** ['a','b','c'] → 'a, b and c' — one list a person reads back without stumbling. */
function listOf(items) {
  if (!items.length) return '';
  if (items.length === 1) return String(items[0]);
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/**
 * "Every Saturday at 09:00" — one line a person can read back.
 *
 * Not only for display: announcements.controller.js writes this into the audit log, and
 * reads an empty string as "the repeat was stopped". A rule that describes itself as ''
 * therefore tells the activity log a lie, which is why every arm here answers for a valid
 * rule, and why the validator refuses an empty list at the door.
 *
 * A one-item list reads EXACTLY as it did before lists existed, so no post's wording
 * changes because of this feature. website/lib/announcement.js mirrors this word for word.
 */
export function describeRule(rule) {
  if (!isValidRule(rule) || rule.type === 'NONE') return '';
  const at = rule.time ? ` at ${rule.time}` : '';
  switch (rule.type) {
    case 'WEEKLY':
      return `Every ${listOf(weekdaysOf(rule).map((w) => WEEKDAYS[w]))}${at}`;
    case 'MONTHLY':
      return `Every month on the ${listOf(monthDays(rule).map(ordinal))}${at}`;
    case 'YEARLY':
      return `Every year on ${listOf(monthDays(rule))} ${MONTHS[rule.month - 1]}${at}`;
    case 'DATES': {
      const ds = ruleDates(rule);
      // Past three, the full list stops being a sentence and starts being a table — and
      // this string sits in a chip on a phone and in a line of the activity log.
      if (ds.length > 3) return `On ${ds.length} dates between ${dayLabel(ds[0])} and ${dayLabel(ds[ds.length - 1])}${at}`;
      return `On ${listOf(ds.map(dayLabel))}${at}`;
    }
    default: return '';
  }
}

/**
 * Strip a rule down to the fields its type actually uses, so stale ones never linger —
 * and migrate a single day into its list on the way in, which is the only write path
 * either shape has.
 *
 * TOTAL on purpose: every list key is present on every type, even empty. Mongoose does
 * not re-apply a sub-document default when the whole sub-object is assigned, so a key left
 * out here is `undefined` on the saved row and missing from its JSON — and the dialog's
 * change-detection compares JSON, so a key that comes and goes reports "recurrence
 * changed" on a save that changed nothing.
 *
 * Sanitising belongs here too: a `[Number]` path validates NOTHING — [10.9, 0, 99] casts
 * and saves without complaint, and 10.9 never equals a day of the month, so the post
 * quietly never goes out.
 */
export function normalizeRule(rule) {
  const type = RECURRENCE_TYPES.includes(rule?.type) ? rule.type : 'NONE';
  const time = rule?.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(rule.time) ? rule.time : '09:00';
  const out = {
    type,
    weekday: null, // legacy single day — read for old rows, never written again
    weekdays: [],
    dayOfMonth: null, // legacy single day — as above
    daysOfMonth: [],
    month: null,
    dates: [],
    time,
  };
  const day = (d) => Number.isInteger(d) && d >= 1 && d <= 31;
  if (type === 'WEEKLY') out.weekdays = weekdaysOf(rule).filter((w) => Number.isInteger(w) && w >= 0 && w <= 6);
  if (type === 'MONTHLY') out.daysOfMonth = monthDays(rule).filter(day);
  if (type === 'YEARLY') {
    out.month = rule.month;
    out.daysOfMonth = monthDays(rule).filter(day);
  }
  // Cap AFTER sorting, so trimming drops the furthest-out dates rather than whichever
  // happened to arrive last.
  if (type === 'DATES') out.dates = ruleDates(rule).filter(isRealYMD).slice(0, MAX_RULE_DATES);
  return out;
}

/** Minutes past midnight for 'HH:mm'. */
export function minutesOf(time) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
