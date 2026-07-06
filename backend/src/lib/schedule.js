import { ymdInTz, formatCompany } from './time.js';

/**
 * The effective work schedule for a user.
 *
 * Full-time staff follow the company-wide office hours (Settings). Part-time
 * staff have their own check-in / check-out / grace, stored on the user. This is
 * the ONE place that resolves which applies — attendance late-detection, overtime,
 * the live check-in card, and correction approvals all go through it, so the two
 * never drift apart.
 *
 * @param {{employmentType?: string, schedule?: {workStart?:string, workEnd?:string, graceMinutes?:number}}} user
 * @param {{workStart:string, workEnd:string, graceMinutes:number}} settings
 * @returns {{workStart:string, workEnd:string, graceMinutes:number, partTime:boolean}}
 */
export function effectiveSchedule(user, settings) {
  const s = user?.schedule || {};
  // ANY user (full-time or part-time) may set their own hours. If they haven't,
  // the company office hours apply. Custom = both check-in and check-out set.
  const hasHours = !!(s.workStart && s.workEnd);
  return {
    workStart: s.workStart || settings.workStart,
    workEnd: s.workEnd || settings.workEnd,
    graceMinutes: hasHours ? (Number.isFinite(s.graceMinutes) ? s.graceMinutes : 0) : settings.graceMinutes,
    custom: hasHours,
    partTime: user?.employmentType === 'PART_TIME',
  };
}

/**
 * The day-of-week numbers (0=Sun … 6=Sat) a user does NOT work — i.e. their
 * "weekends", for absent/working-day math. A part-timer with an explicit
 * `schedule.workDays` list works only those days; everyone else (and part-timers
 * who left it blank) follows the company-wide weekend config in Settings.
 */
export function userWeekendDays(user, settings) {
  const wd = user?.schedule?.workDays;
  // Any user with an explicit working-days list works only those days; otherwise
  // the company weekend config applies.
  if (Array.isArray(wd) && wd.length) {
    const works = new Set(wd);
    return [0, 1, 2, 3, 4, 5, 6].filter((d) => !works.has(d));
  }
  return settings.weekendDays;
}

/**
 * Has the work window for `user` on day `dateYMD` already closed as of `now`?
 *
 * A no-show should only count as "absent" once the office day is actually over —
 * before that they may still turn up, so it shows as "—", not "Absent". A PAST
 * day is always finished; a FUTURE day never is; TODAY closes the moment company
 * time reaches the user's own work-end (so part-timers use their own end time).
 */
export function workWindowClosed(user, dateYMD, settings, now = new Date()) {
  const today = ymdInTz(now);
  if (dateYMD < today) return true; // a past day is finished
  if (dateYMD > today) return false; // a future day hasn't started
  const { workEnd } = effectiveSchedule(user, settings);
  return formatCompany(now, 'HH:mm') >= workEnd; // "HH:mm" compares correctly zero-padded
}
