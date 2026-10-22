import { companyDayInstantAt, ymdInTz } from './time.js';

/**
 * The late-arrival ladder (owner's rule, 12 Sep 2026 — in force from LATE_LADDER_FLOOR_YMD).
 *
 * A late check-in is no longer one flat penalty; it climbs by the hour, and everyone is
 * measured against their OWN shift:
 *
 *   Normal day — due at your start time. Arrive past the grace → 1 rung. Arrive past the
 *   first full hour after your start (11:00 on a 10-to-6 shift) → 2 rungs. That is the
 *   ceiling: 12:01 costs exactly what 11:01 costs ("morning me maximum 2").
 *
 *   Afternoon half (a FIRST-half leave, so the person owes the afternoon) — due at the
 *   midpoint of the shift (2:00 PM on 10-to-6) with NO grace: 2:01 is 1 rung. Then one
 *   more rung at every hour mark after it, right up to the shift end: past 3:00 → 2,
 *   past 4:00 → 3, past 5:00 → 4.
 *
 *   Morning half (a SECOND-half leave, so the person owes the MORNING) — from
 *   MORNING_HALF_LATE_FLOOR_YMD it is judged exactly like an ordinary morning: the grace,
 *   then the first full hour after it, and that is the ceiling (owner's decision, 16 Oct
 *   2026: "late aaye to late lagna chahiye — chahe first half ho ya second"). Until that
 *   floor this day could never be late at all, whatever time the person walked in.
 *
 * Each rung costs the `lateArrival` amount from the bonus settings, so a 2-rung day is
 * −2 × that. "Past" a mark is strict — 11:00:00 on the dot is not past 11:00.
 *
 * Before the floor a late day is exactly one rung (the old flat −1) and a half-day is
 * never late whichever half (the older owner rule). Both stay true for old dates, so a
 * leadership edit or a month recalculation never rewrites what an earlier month paid.
 */
export const LATE_LADDER_FLOOR_YMD = '2026-09-13';
/**
 * From this day the WORKED MORNING of a half-day can be late (owner, 16 Oct 2026).
 *
 * Before it, `lateMarksHM` handed back an empty list for that day, so a 10:00 starter
 * could stroll in at 13:00 on an afternoon-off day and still be recorded PRESENT. The
 * floor is what keeps September's rows judged by September's rule — the stored `status`
 * of a finished day is never rewritten by this change, only days judged from here on.
 */
export const MORNING_HALF_LATE_FLOOR_YMD = '2026-10-01';
/** How high a normal day's ladder goes. */
export const NORMAL_DAY_MAX_RUNGS = 2;

function hmToMin(hm) {
  const [h, m] = String(hm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minToHM(min) {
  const v = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** 'HH:mm' halfway through a shift — where its afternoon half begins (10–6 → 14:00). */
export function shiftMidpoint(workStart, workEnd) {
  return minToHM(Math.floor((hmToMin(workStart) + hmToMin(workEnd)) / 2));
}

/**
 * Selfie se laga hua check-in. Us par late NAHI lagti — owner ka niyam (site par jaane
 * walon ke liye), aur uska ikloata nishaan `checkInMeta.selfieKey` hai.
 *
 * Ye chhoot pehle SIRF check-in ke waqt lagti thi. Uske baad jo bhi raasta us din ko
 * dobara tolta hai — half-day leave lagna ya hatna, leadership ka time edit, correction
 * approve — wo ladder se seedha poochta tha aur PRESENT ko chupchaap LATE kar deta tha.
 * Us din ki selfie wahin padi rehti thi aur niyam aadha hi laagu hota tha. Ab har raasta
 * yahi ek sawaal poochta hai.
 */
export const isSelfieCheckIn = (record) => !!record?.checkInMeta?.selfieKey;

/** True when this day's record makes the person an afternoon-half worker under the rule. */
export function isAfternoonHalf(ymd, record) {
  return !!record?.halfDayLeave && record.halfDayPart === 'FIRST' && ymd >= LATE_LADDER_FLOOR_YMD;
}

/**
 * The marks ('HH:mm', company time, ascending) a check-in on `ymd` is measured against:
 * a check-in past k of them is k rungs. Empty = this day cannot be late at all (the
 * worked morning of a half-day, or any half-day before the floor). `record` only needs
 * halfDayLeave / halfDayPart and may be null (nothing recorded yet = a normal day).
 */
export function lateMarksHM(ymd, record, sched) {
  if (record?.halfDayLeave) {
    // Before the ladder existed no half-day was late, whichever half. Unchanged.
    if (ymd < LATE_LADDER_FLOOR_YMD) return [];
    if (isAfternoonHalf(ymd, record)) {
      const until = hmToMin(sched.workEnd);
      const marks = [];
      for (let m = hmToMin(shiftMidpoint(sched.workStart, sched.workEnd)); m < until; m += 60) marks.push(m);
      return marks.map(minToHM);
    }
    // The worked MORNING (an afternoon/SECOND-half leave). Only an explicit 'SECOND' —
    // a half-day row with no part recorded is left alone rather than guessed at, since
    // leave.service writes FIRST whenever the half is unknown.
    if (record.halfDayPart !== 'SECOND' || ymd < MORNING_HALF_LATE_FLOOR_YMD) return [];
    // Judged like any other morning, but never past the midpoint: after it they are not
    // due in at all, so the ceiling is the same 2 rungs everyone else's morning carries.
    const mid = hmToMin(shiftMidpoint(sched.workStart, sched.workEnd));
    return normalMarksMin(sched).filter((m) => m < mid).map(minToHM);
  }
  if (ymd < LATE_LADDER_FLOOR_YMD) {
    // The old flat rule: one rung, at the end of the grace.
    return [minToHM(hmToMin(sched.workStart) + Math.max(0, Number(sched.graceMinutes) || 0))];
  }
  return normalMarksMin(sched).map(minToHM);
}

/**
 * An ordinary morning's marks, in minutes: the end of the grace, then the first full hour
 * after it, up to NORMAL_DAY_MAX_RUNGS. An hour mark that falls INSIDE the grace is not a
 * rung of its own — the grace already covers it.
 */
function normalMarksMin(sched) {
  const start = hmToMin(sched.workStart);
  const graceEnd = start + Math.max(0, Number(sched.graceMinutes) || 0);
  const marks = [graceEnd];
  for (let k = 1; marks.length < NORMAL_DAY_MAX_RUNGS; k += 1) {
    const m = start + 60 * k;
    if (m > graceEnd) marks.push(m);
  }
  return marks;
}

/** The same marks as instants on `day` (a company-day instant). */
export function lateMarksAt(day, record, sched) {
  return lateMarksHM(ymdInTz(day), record, sched).map((hm) => companyDayInstantAt(day, hm));
}

/**
 * Judge a check-in at `checkInAt` on `day`: how many rungs it climbs (0 = on time) and
 * whether it was judged as the afternoon half. Off-days (holiday, weekend, birthday) are
 * the caller's business — they never reach here.
 */
export function judgeCheckIn(checkInAt, day, record, sched) {
  const afternoon = isAfternoonHalf(ymdInTz(day), record);
  if (!checkInAt) return { rungs: 0, afternoon };
  const t = new Date(checkInAt).getTime();
  const rungs = lateMarksAt(day, record, sched).filter((m) => t > m.getTime()).length;
  return { rungs, afternoon };
}

/**
 * What a stored record owes: 0 rungs unless it is LATE, not excused, and its day's window
 * is on. A LATE status the ladder can no longer explain (the schedule was changed after
 * the day) still owes at least one rung — the day WAS marked late.
 */
export function penaltyRungs(record, day, sched) {
  const afternoon = isAfternoonHalf(ymdInTz(day), record);
  if (!record?.checkInAt || record.status !== 'LATE' || record.excused) return { rungs: 0, afternoon };
  if (!lateMarksAt(day, record, sched).length) return { rungs: 0, afternoon };
  const { rungs } = judgeCheckIn(record.checkInAt, day, record, sched);
  return { rungs: Math.max(1, rungs), afternoon };
}

/** The ledger line for a late day — the rung count is spelt out only when it matters. */
export function lateReasonText(ymd, { rungs = 1, afternoon = false } = {}) {
  const head = afternoon ? `Late arrival (afternoon half) · ${ymd}` : `Late arrival · ${ymd}`;
  if (rungs <= 1) return head;
  const h = rungs - 1;
  return `${head} · over ${h} hour${h > 1 ? 's' : ''} late`;
}
