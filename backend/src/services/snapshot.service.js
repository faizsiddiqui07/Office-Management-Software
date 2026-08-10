import { Task } from '../models/Task.js';
import { PointEntry } from '../models/PointEntry.js';
import { Setting } from '../models/Setting.js';
import { can } from '../lib/permissions.js';
import { companyDayFromYMD, ymdInTz } from '../lib/time.js';
import { joinedYMD } from '../lib/joining.js';
import { leaveYearOf } from '../lib/leaveYear.js';
import { buildSelfReport } from './report.service.js';
import { carryInFor } from './bonus.service.js';
import { balanceJSONReadOnly } from './leave.service.js';

/**
 * "Where do I stand" — one answer, for a period the person picks.
 *
 * Built ON TOP of buildSelfReport rather than beside it. That function already owns
 * the hard parts (company timezone, the fiscal year, weekends, holidays, custom
 * schedules, the joining-date and go-live floors, and not counting today as absent
 * before the day is over), and it feeds the PDF report too. Re-deriving any of that
 * here would be a second version of the truth waiting to disagree with the first.
 *
 * THE DISTINCTION THAT MATTERS: some of this moves with the period and some does not.
 * Days present, hours, leave taken, tasks closed, dues added — those belong to a
 * stretch of time. Leave REMAINING is a figure for the whole leave year; what you owe
 * the office is a running balance; bonus points reset monthly. Applying the period
 * filter to those would produce "your leave balance for Tuesday", which is not a
 * thing. So they are returned separately, as `standing`, and the UI labels them as
 * where you are RIGHT NOW.
 */
export async function mySnapshot(user, { type = 'monthly', dateYMD, range } = {}) {
  const today = ymdInTz(new Date());
  const anchor = dateYMD || today;
  const report = await buildSelfReport({ user, type, dateYMD: anchor, range });
  const { from, to } = report.period;
  const settings = await Setting.getSingleton();

  // What this person is allowed to be measured on at all. Leadership neither checks in
  // nor applies for leave, so showing them a 0% attendance rate would be a made-up
  // failure, not a fact.
  const shows = {
    attendance: can(user, 'markAttendance'),
    leave: can(user, 'applyLeave'),
    // Work from home goes with self-tracked attendance — leadership neither checks in
    // nor requests WFH days.
    wfh: can(user, 'markAttendance'),
    tasks: true,
    dues: true,
    points: !!settings.bonus?.enabled,
  };

  // Did this period end before they arrived? Then there is nothing to show, and saying
  // so is better than a screen of zeros that reads like a bad month.
  const joined = joinedYMD(user);
  const notYetHere = !!joined && joined > to;

  const fromDay = companyDayFromYMD(from);
  const toDay = companyDayFromYMD(to);
  // toDay is the START of the last day, so anything later that day would fall outside
  // a $lte on it. Push to the end of that day.
  const toDayEnd = new Date(toDay.getTime() + 86400000 - 1);

  const thisMonth = today.slice(0, 7);
  const [doneInPeriod, openNow, overdueNow, periodPointsAgg, monthPoints, carriedOver, todayBalance] = await Promise.all([
    shows.tasks
      ? Task.countDocuments({ owner: user._id, status: 'DONE', completedAt: { $gte: fromDay, $lte: toDayEnd } })
      : 0,
    shows.tasks ? Task.countDocuments({ owner: user._id, status: 'PENDING' }) : 0,
    shows.tasks
      ? Task.countDocuments({ owner: user._id, status: 'PENDING', dueYMD: { $ne: '', $lt: today } })
      : 0,
    // Points earned INSIDE the window, by the day they were earned (earnedYMD), NOT the day
    // the row was written. createdAt was wrong: the whole ledger gets rewritten by the
    // history backfill / re-score jobs, so July's entries carry an August createdAt — and
    // "this month" then swept July's points in too (e.g. 134 + 38 = 172 instead of 38).
    // earnedYMD is a plain 'YYYY-MM-DD', so a lexicographic range matches any window.
    //
    // SUMMED IN THE DATABASE, not in JS off a fetched page. This used to `.find().limit(100)`
    // and reduce the rows it got back, so the figure was the sum of at most a hundred
    // entries -- and since the sort is newest-first, it was the window's OLDEST points that
    // silently fell off. A fiscal-year view for anyone with a busy few months therefore
    // under-reported, and disagreed with the Rewards page, which aggregates the same window.
    shows.points ? PointEntry.aggregate([
      { $match: { user: user._id, earnedYMD: { $gte: from, $lte: to } } },
      { $group: { _id: null, points: { $sum: '$points' } } },
    ]) : [],
    shows.points ? PointEntry.aggregate([
      { $match: { user: user._id, month: thisMonth } },
      { $group: { _id: null, points: { $sum: '$points' } } },
    ]) : [],
    // The deficit carried into this month. Without it this page showed raw earnings while
    // the header badge, the Rewards page, the leaderboard and the company report all showed
    // the NET standing -- the same person reading two different numbers on two screens.
    shows.points ? carryInFor(user._id, thisMonth) : 0,
    // Leave + WFH allowances are a STANDING figure, so they follow today's leave year, not
    // the period's. The report's own balance is anchored to `period.from` (right for a PDF
    // of that period) -- reusing it here meant that, viewed after 1 April, a range inside
    // the previous fiscal year would show last year's remaining under a heading that
    // promises "these don't change with the period above".
    shows.leave ? balanceJSONReadOnly(user, leaveYearOf(today)) : null,
  ]);

  // Dues movement inside the period, from the entries the report already scoped.
  const entries = report.dues?.entries ?? [];
  const dueEntries = entries.filter((e) => e.kind === 'DUE');
  const duesAdded = dueEntries.reduce((s, e) => s + e.amount, 0);
  const duesPaid = entries.filter((e) => e.kind !== 'DUE').reduce((s, e) => s + e.amount, 0);
  // Are the items the admin added this period settled? Each due carries its status from
  // the full-ledger reducer — it turns PAID once it's covered, whether by an advance
  // paid earlier, a later payment, or the admin's settle button. So "every due this
  // period is PAID" is the honest answer to "is this month cleared?", and it stops the
  // advance case from reading as unpaid just because the money went in a month earlier.
  // Only meaningful when something was actually added.
  const duesSettled = dueEntries.length > 0 && dueEntries.every((e) => e.status === 'PAID');

  // Leave days INSIDE the window. Summing each overlapping request's `workingDays` counted
  // the whole request every time it touched the period -- a 29 Jul-4 Aug leave read as 6
  // days in July, 6 again in August, and 6 on a one-day view of 30 July. The attendance
  // totals already hold the per-day truth for exactly this window (half-days as 0.5), so
  // the two cards can no longer disagree.
  const leaveTakenDays = report.attendance?.totals?.onLeave ?? 0;
  const pointsEarned = periodPointsAgg[0]?.points ?? 0;
  const monthEarned = monthPoints[0]?.points ?? 0;
  const carry = carriedOver || 0; // <= 0

  return {
    period: { ...report.period, type },
    // The period runs past today (e.g. "this month" mid-month): everything below counts
    // only up to asOfYMD, and the UI says so rather than implying the rest was missed.
    ongoing: report.ongoing,
    asOfYMD: report.asOfYMD,
    notYetHere,
    joinedYMD: joined,
    shows,
    currency: settings.currency,

    // ── Moves with the period ──
    inPeriod: {
      attendance: report.attendance.totals,
      leaveDays: leaveTakenDays,
      leaves: report.leaves?.taken ?? [],
      tasksDone: doneInPeriod,
      duesAdded,
      duesPaid,
      duesSettled,
      points: pointsEarned,
    },

    // ── Where you are right now, whatever period is selected ──
    standing: {
      leave: todayBalance ?? null,
      // The yearly work-from-home allowance is a standing figure (Apr-Mar), not a
      // period one -- "how many WFH days are left on Tuesday" isn't a thing.
      wfh: todayBalance?.wfh
        ? { used: todayBalance.wfh.used, cap: todayBalance.wfh.cap, remaining: todayBalance.wfh.remaining }
        : null,
      duesPending: report.dues?.pending ?? 0,
      duesAdvance: report.dues?.advance ?? 0,
      tasksOpen: openNow,
      tasksOverdue: overdueNow,
      // All three, so the card can lead with the NET standing (what the badge and the
      // Rewards page show) and still explain a drop: "38 earned, 20 carried over".
      pointsThisMonth: monthEarned + carry,
      pointsEarnedThisMonth: monthEarned,
      pointsCarriedOver: carry,
      pointsMonth: thisMonth,
      rupeesPerPoint: settings.bonus?.rupeesPerPoint || 0,
    },
  };
}
