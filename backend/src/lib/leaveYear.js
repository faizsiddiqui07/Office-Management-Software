import { ymdInTz } from './time.js';

/**
 * Leave years run on the company's FISCAL calendar: April 1 → March 31.
 * The "year" key stored on a LeaveBalance is the STARTING calendar year of that
 * fiscal window. Examples:
 *   2026-07-01 → 2026  (Apr 2026 – Mar 2027)
 *   2027-02-15 → 2026  (still the Apr 2026 – Mar 2027 window)
 *   2027-04-01 → 2027  (new window begins)
 * @param {string} ymd  a 'YYYY-MM-DD' date
 */
export function leaveYearOf(ymd) {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  return month >= 4 ? year : year - 1;
}

/** The current fiscal leave year (company timezone). */
export function currentLeaveYear() {
  return leaveYearOf(ymdInTz(new Date()));
}
