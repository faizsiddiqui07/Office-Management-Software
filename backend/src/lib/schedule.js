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
  if (user?.employmentType === 'PART_TIME') {
    return {
      workStart: s.workStart || settings.workStart,
      workEnd: s.workEnd || settings.workEnd,
      graceMinutes: Number.isFinite(s.graceMinutes) ? s.graceMinutes : settings.graceMinutes,
      partTime: true,
    };
  }
  return {
    workStart: settings.workStart,
    workEnd: settings.workEnd,
    graceMinutes: settings.graceMinutes,
    partTime: false,
  };
}
