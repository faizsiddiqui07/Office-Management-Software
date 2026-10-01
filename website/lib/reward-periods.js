/**
 * Reward-period options for the Rewards page selector.
 *
 * The office went live in July 2026, so the earliest month with any data is 2026-07 and the
 * earliest financial year is FY 2026–27 (Apr 2026 – Mar 2027, effectively Jul–Mar because
 * the system wasn't running before that). Financial year 2026 = Apr 2026 – Mar 2027, exactly
 * like the leave module.
 *
 * Two things here are easy to get wrong, and both were:
 *
 *  • "Now" is the office's day, not UTC. The server stamps every point entry's month in IST,
 *    so a picker working off UTC spends the first five and a half hours of each new month
 *    offering a list that stops at the previous one — while the header's points badge, filled
 *    in by the server, already shows the new month. Same again on 1 April for the FY list.
 *  • The go-live month belongs to lib/app-live.js. The same build serves team.* and demo.*,
 *    and the demo carries seeded history from April; a second hardcoded copy here put the
 *    demo's first three months out of reach of this picker and of the dashboard's MonthPicker,
 *    which imports the constant from this file.
 */

import { APP_LIVE_MONTH } from '@/lib/app-live';

export { APP_LIVE_MONTH };

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The office's current { y, m } — IST, like every month the server stamps. */
function nowYM(nowDate = new Date()) {
  const ist = new Date(nowDate.getTime() + IST_OFFSET_MS);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth() + 1 };
}

/** The office's current month as 'YYYY-MM'. */
export function currentMonth(nowDate = new Date()) {
  const { y, m } = nowYM(nowDate);
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** 'YYYY-MM' → 'Jul 2026' etc. */
export function monthLabel(m) {
  const [y, mm] = String(m).split('-').map(Number);
  if (!y || !mm) return '';
  const d = new Date(Date.UTC(y, mm - 1, 1));
  return d.toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function addMonths(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** [{value, label}] — go-live up to the current month (both inclusive), newest first. */
export function monthOptions(nowDate = new Date()) {
  const cur = currentMonth(nowDate);
  const out = [];
  let m = APP_LIVE_MONTH;
  while (m <= cur) { out.push({ value: m, label: monthLabel(m) }); m = addMonths(m, 1); }
  return out.reverse();
}

/**
 * The calendar years that have data — go-live's year up to this one, newest first. Paired
 * with monthsInYear() this keeps the month picker two short lists instead of one flat list
 * that grows by twelve entries a year (54 of them by 2030, which is what prompted this).
 */
export function yearOptions(nowDate = new Date()) {
  const first = Number(APP_LIVE_MONTH.slice(0, 4));
  const { y: last } = nowYM(nowDate);
  const out = [];
  for (let y = first; y <= last; y += 1) out.push(y);
  return out.reverse();
}

/**
 * The selectable months inside one calendar year, oldest first — clipped at both ends: the
 * go-live year starts at the go-live month, this year stops at this month. [] for a year
 * outside the recorded range.
 */
export function monthsInYear(year, nowDate = new Date()) {
  const y = Number(year);
  const liveY = Number(APP_LIVE_MONTH.slice(0, 4));
  const { y: curY, m: curM } = nowYM(nowDate);
  if (!y || y < liveY || y > curY) return [];
  const first = y === liveY ? Number(APP_LIVE_MONTH.slice(5, 7)) : 1;
  const last = y === curY ? curM : 12;
  if (last < first) return [];
  const out = [];
  for (let m = first; m <= last; m += 1) {
    const value = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ value, month: m, label: monthLabel(value) });
  }
  return out;
}

/**
 * Where to land when the year changes and the selected month doesn't exist in the new year —
 * the NEAREST month that does, so stepping back from Feb 2027 into 2026 lands on Dec 2026
 * rather than jumping to a month at the other end of the year.
 */
export function clampToYear(month, year, nowDate = new Date()) {
  const months = monthsInYear(year, nowDate);
  if (!months.length) return month;
  const want = Number(String(month).slice(5, 7)) || months[months.length - 1].month;
  const first = months[0];
  const last = months[months.length - 1];
  if (want <= first.month) return first.value;
  if (want >= last.month) return last.value;
  return months.find((o) => o.month === want)?.value || last.value;
}

/**
 * Financial-year options — { value: 'YYYY', label: 'FY YYYY–YY', from: 'YYYY-04',
 * to: 'YYYY+1-03' }, newest first, from the financial year containing go-live to the one
 * containing today. This list grows by a single entry a year, so it stays a plain dropdown.
 */
export function fyOptions(nowDate = new Date()) {
  // The FY containing a date: Apr–Dec of year Y → FY Y; Jan–Mar of year Y → FY Y-1.
  const { y, m } = nowYM(nowDate);
  const curFy = m >= 4 ? y : y - 1;
  const liveY = Number(APP_LIVE_MONTH.slice(0, 4));
  const liveM = Number(APP_LIVE_MONTH.slice(5, 7));
  const START = liveM >= 4 ? liveY : liveY - 1;
  const out = [];
  for (let fy = START; fy <= curFy; fy += 1) {
    out.push({
      value: String(fy),
      label: `FY ${fy}–${String(fy + 1).slice(-2)}`,
      from: `${fy}-04`,
      to: `${fy + 1}-03`,
    });
  }
  return out.reverse();
}

/** For the picked selection, the queryParams to pass to useMyBonus + a human label. */
export function paramsForSelection(mode, value) {
  if (mode === 'monthly') return { params: { month: value }, label: monthLabel(value) };
  // Worked out arithmetically rather than looked up in fyOptions(). A year that had fallen
  // off that list used to fall through to `{ params: {} }`, and the backend then quietly
  // answered with the CURRENT month under a blank label — the one failure mode where the
  // screen shows real numbers for a period nobody asked for.
  const fy = Number(value);
  if (!fy) return { params: {}, label: '' };
  return { params: { from: `${fy}-04`, to: `${fy + 1}-03` }, label: `FY ${fy}–${String(fy + 1).slice(-2)}` };
}
