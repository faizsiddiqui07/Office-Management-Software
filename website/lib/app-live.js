/**
 * The day this system went live for the office: 1 July 2026.
 *
 * No operational data (attendance, reports, expenses, tasks, visitors…) exists
 * before it, so data-viewing date pickers use this as their floor — earlier dates
 * aren't selectable at all, instead of opening an empty month that reads as
 * "everyone absent". Identity dates are exempt: a joining date or a date of birth
 * is history, not data, and must reach back as far as real life does.
 *
 * Mirrors backend/src/lib/appLive.js — the backend uses the same day as the
 * boundary for pro-rata leave (existing staff keep the full quota).
 */
export const APP_LIVE_YMD = '2026-07-01';
export const APP_LIVE_MONTH = '2026-07';
