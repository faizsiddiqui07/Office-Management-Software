import { companyDayFromYMD, dayOfWeekInTz } from './time.js';
import { isBirthdayYMD } from './birthday.js';

/**
 * ONE day's verdict for the rolling punctual streak — the single place that rule lives.
 *
 * It used to live in three: the live scan (runRollingStreak), the rebuild's independent
 * verifier (expectedLedger) and, from now on, the read-side preview that lets My Summary
 * show today. Three copies of a rule is three chances for them to disagree, and when the
 * verifier disagrees with the scan the owner's "Recalculate points" shows a phantom diff
 * every single day. They all call this now.
 *
 * The verdicts:
 *   NEUTRAL  — not a day they were due in (off-day, holiday, their birthday, WFH,
 *              approved leave). Neither extends the run nor breaks it.
 *   ON_TIME  — one more day on the run.
 *   BREAK    — the run resets to 0 and the NEXT day starts a fresh one.
 *   PENDING  — only ever returned with `live: true`: the day is not over and nothing has
 *              been recorded yet, so it is too early to say. Treated as "no change".
 *
 * `live` is the whole difference between judging TODAY and judging a finished day. On a
 * finished day a missing record means an unexplained absence and breaks the run; today it
 * means "they haven't arrived yet", and breaking everyone's streak at 00:01 would be
 * absurd. Owner's decision (16 Oct 2026): a no-show is still judged by the nightly scan,
 * never live.
 */
export const STREAK_LEN = 6;

/**
 * From this day on, a LATE on a half-day breaks the run like any other late — whichever
 * half it is (owner's decision, 16 Oct 2026, in force from 1 Oct 2026).
 *
 * Until now ANY half-day late was forgiven here — a rule written when a half-day carried
 * no penalty at all. Since the late ladder (13 Sep 2026) an afternoon-half worker can be
 * charged up to 4 rungs, so the same day could cost someone 4 points and leave their
 * punctual streak untouched.
 *
 * The floor keeps history exactly as it was paid: a re-walk of August still judges August
 * by August's rule. Choosing 1 Oct costs nothing in practice — on the day this was
 * written there was not a single half-day row with status LATE in the whole database.
 */
export const HALF_DAY_LATE_BREAKS_YMD = '2026-10-01';

export const STREAK_NEUTRAL = 'NEUTRAL';
export const STREAK_ON_TIME = 'ON_TIME';
export const STREAK_BREAK = 'BREAK';
export const STREAK_PENDING = 'PENDING';

/** Is this LATE forgiven because it fell on a half-day? (Only before the floor.) */
export function halfDayLateForgiven(record, ymd) {
  return !!record?.halfDayLeave && ymd < HALF_DAY_LATE_BREAKS_YMD;
}

/**
 * What `ymd` does to `user`'s run.
 *
 * Everything it needs is passed in — no queries, no clock — so the scan can judge a
 * hundred days from data it already has in memory and the read path can judge one.
 *
 *   record     the Attendance row for that day, or null
 *   onLeave    an APPROVED leave covers that day
 *   isHoliday  a company holiday falls on it
 *   offDays    this person's non-working weekdays (0=Sun…6=Sat)
 *   live       judging TODAY, which is not over yet
 */
export function judgeStreakDay(user, ymd, { record = null, onLeave = false, isHoliday = false, offDays = [], live = false } = {}) {
  // Sunday / their own off-day / company holiday / their own birthday → neutral: neither
  // breaks the run nor counts towards it, exactly like any other day they weren't due in.
  if (offDays.includes(dayOfWeekInTz(companyDayFromYMD(ymd))) || isHoliday || isBirthdayYMD(user, ymd)) {
    return STREAK_NEUTRAL;
  }
  // HOLIDAY is a real value in the Attendance status enum (models/Attendance.js) and
  // means the same thing the company holiday set means: nobody was due in. Without it
  // such a row slipped past every branch below and was quietly counted as an ON-TIME day.
  // No row in the live data carries it today — this closes the hole before one does.
  if (record && (record.status === 'WFH' || record.status === 'ON_LEAVE' || record.status === 'HOLIDAY')) {
    return STREAK_NEUTRAL;
  }
  if (record && record.status === 'LATE' && !record.excused && !halfDayLateForgiven(record, ymd)) {
    return STREAK_BREAK;
  }
  if (!record || record.status === 'ABSENT') {
    if (onLeave) return STREAK_NEUTRAL;
    // Today, "nothing recorded" is not an absence yet — the day can still turn into a
    // check-in, approved leave, a WFH declaration or an emergency holiday.
    return live ? STREAK_PENDING : STREAK_BREAK;
  }
  // PRESENT on time (or an excused, on-duty late) → one more day on the run.
  return STREAK_ON_TIME;
}
