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
// The same build serves both team.* and demo.*. The demo carries months of seeded
// history, so on a demo.* host the floor is earlier; team.* stays exactly 2026-07-01.
// Resolved once at module load (client-side hostname), so every importer gets the right
// value without any per-file change.
function resolveAppLive() {
  if (typeof window !== 'undefined' && window.location.hostname.startsWith('demo.')) {
    return '2026-04-01';
  }
  return '2026-07-01';
}
export const APP_LIVE_YMD = resolveAppLive();
export const APP_LIVE_MONTH = APP_LIVE_YMD.slice(0, 7);
