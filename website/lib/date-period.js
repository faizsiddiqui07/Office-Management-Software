import { companyYMD } from './time';

/**
 * One date window for every list in the app: this month, last month, the last
 * three months, or dates you pick yourself.
 *
 * Two rules the whole app follows from here:
 *
 *   • A month means the WHOLE month, 1st to last — not "1st up to today". Leave
 *     requests and scheduled announcements are dated into the future, and a
 *     window that stopped at today hid a leave booked for the 20th from anyone
 *     looking on the 15th, under a chip that plainly said "This month".
 *
 *   • Boundaries are built from COMPANY time (lib/time.js), never from the
 *     device clock. A phone left on another timezone would otherwise roll into
 *     the next month hours early and quietly show a different list than the
 *     laptop next to it.
 *
 * Windows are plain 'YYYY-MM-DD' strings, so comparing them is string
 * comparison — no Date objects, no timezone to get wrong a second time.
 */
export const PERIOD_PRESETS = [
  { value: 'all', label: 'All time' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_3', label: 'Last 3 months' },
  { value: 'custom', label: 'Custom' },
];

/** The default everywhere: no window at all, i.e. the list as it always was. */
export const ALL_TIME = Object.freeze({ preset: 'all', from: '', to: '' });

const pad = (n) => String(n).padStart(2, '0');
const monthStart = (y, m) => `${y}-${pad(m)}-01`;
// Day 0 of the NEXT month is the last day of this one — and it knows about
// February, leap years included.
const monthEnd = (y, m) => `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;

/** Shift a year+month (m is 1–12) by whole months, rolling the year over. */
function shiftMonth(y, m, by) {
  const i = y * 12 + (m - 1) + by;
  return [Math.floor(i / 12), (i % 12) + 1];
}

/** A preset (plus its custom dates) → { from, to }; '' on either side = open-ended. */
export function resolvePeriod(period) {
  const { preset = 'all', from = '', to = '' } = period || {};
  if (preset === 'custom') return { from, to };
  if (preset !== 'this_month' && preset !== 'last_month' && preset !== 'last_3') {
    return { from: '', to: '' };
  }
  const today = companyYMD(new Date());
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  if (preset === 'last_month') {
    const [ly, lm] = shiftMonth(y, m, -1);
    return { from: monthStart(ly, lm), to: monthEnd(ly, lm) };
  }
  if (preset === 'last_3') {
    // Three CALENDAR months counting this one: Aug 1 → Oct 31 when it is October.
    const [sy, sm] = shiftMonth(y, m, -2);
    return { from: monthStart(sy, sm), to: monthEnd(y, m) };
  }
  return { from: monthStart(y, m), to: monthEnd(y, m) };
}

/** Is anything actually being filtered out? ("Custom" with no dates is not.) */
export const isPeriodActive = (range) => !!(range && (range.from || range.to));

/** Is one 'YYYY-MM-DD' inside the window? A row with no date is never inside one. */
export function inPeriod(ymd, range) {
  if (!ymd) return false;
  if (range?.from && ymd < range.from) return false;
  if (range?.to && ymd > range.to) return false;
  return true;
}

/** Same, for an instant (ISO string / Date) — read in company time first. */
export function instantInPeriod(value, range) {
  return inPeriod(companyYMD(value), range);
}

/**
 * Does a start→end span TOUCH the window?
 *
 * A leave from 28 Sep to 3 Oct belongs to BOTH months; filtering on its start
 * date alone would drop it from October, where it is three of the five working
 * days somebody is looking for.
 */
export function overlapsPeriod(startYMD, endYMD, range) {
  const s = startYMD || endYMD;
  const e = endYMD || startYMD;
  if (!s) return false;
  if (range?.from && e < range.from) return false;
  if (range?.to && s > range.to) return false;
  return true;
}

const pretty = (ymd) =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "1 Oct 2026 – 31 Oct 2026" / "since 1 Oct 2026" — for the "showing X of Y" line. */
export function describePeriod(range) {
  if (!isPeriodActive(range)) return '';
  if (range.from && range.to) return `${pretty(range.from)} – ${pretty(range.to)}`;
  return range.from ? `since ${pretty(range.from)}` : `up to ${pretty(range.to)}`;
}
