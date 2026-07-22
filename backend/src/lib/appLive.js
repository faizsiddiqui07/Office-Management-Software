/**
 * The day this system went live for the office: 1 July 2026.
 *
 * Two rules hang off it:
 *  - Anyone whose joining date is on or before this day is EXISTING STAFF. Their
 *    stored joining dates are a mix of real history (2022) and "the day they got
 *    website access" (1 July 2026), and neither is grounds to dock leave — they get
 *    the full annual quota. Pro-rata is only for people hired after the office
 *    started running on this system.
 *  - No operational data (attendance, reports, expenses…) exists before this day,
 *    so date filters in the UI don't offer earlier dates.
 */
export const APP_LIVE_YMD = '2026-07-01';
