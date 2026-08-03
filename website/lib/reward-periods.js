/**
 * Reward-period options for the Rewards page selector.
 *
 * The office went live in July 2026, so the earliest month with any data is 2026-07 and
 * the earliest financial year is FY 2026–27 (Apr 2026 – Mar 2027, effectively Jul–Mar
 * because the system wasn't running before that). Financial year 2026 = Apr 2026 – Mar
 * 2027, exactly like the leave module.
 */

export const APP_LIVE_MONTH = '2026-07';

/** 'YYYY-MM' → 'Jul 2026' etc. */
export function monthLabel(m) {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mm - 1, 1));
  return d.toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function addMonths(ymd1, delta) {
  const [y, m] = ymd1.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** [{value, label}] — Jul 2026 up to the current month (both inclusive), newest first. */
export function monthOptions(nowDate = new Date()) {
  const cur = `${nowDate.getUTCFullYear()}-${String(nowDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const out = [];
  let m = APP_LIVE_MONTH;
  while (m <= cur) { out.push({ value: m, label: monthLabel(m) }); m = addMonths(m, 1); }
  return out.reverse();
}

/**
 * Financial-year options — { value: 'YYYY', label: 'FY YYYY–YY', from: 'YYYY-04',
 * to: 'YYYY+1-03' }. Only years that overlap with recorded data (starts at FY 2026–27
 * because the office went live in July 2026), up to the FY containing today, newest
 * first.
 */
export function fyOptions(nowDate = new Date()) {
  // The FY containing a given date: Apr–Dec of year Y → FY Y; Jan–Mar of year Y → FY Y-1.
  const y = nowDate.getUTCFullYear();
  const m = nowDate.getUTCMonth() + 1;
  const curFy = m >= 4 ? y : y - 1;
  const START = 2026; // FY 2026–27 covers Apr'26–Mar'27 (system live from July 2026)
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
  const opt = fyOptions().find((o) => o.value === value);
  if (opt) return { params: { from: opt.from, to: opt.to }, label: opt.label };
  return { params: {}, label: '' };
}
