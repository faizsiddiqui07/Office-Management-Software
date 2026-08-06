import { Task } from '../models/Task.js';
import { PointEntry } from '../models/PointEntry.js';
import { Setting } from '../models/Setting.js';
import { can } from '../lib/permissions.js';
import { companyDayFromYMD, ymdInTz } from '../lib/time.js';
import { joinedYMD } from '../lib/joining.js';
import { buildSelfReport } from './report.service.js';

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

  const [doneInPeriod, openNow, overdueNow, pointRows, monthPoints] = await Promise.all([
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
    shows.points
      ? PointEntry.find({ user: user._id, earnedYMD: { $gte: from, $lte: to } }).select('points reason source earnedYMD createdAt').sort({ earnedYMD: -1, createdAt: -1 }).limit(100)
      : [],
    shows.points ? PointEntry.aggregate([
      { $match: { user: user._id, month: today.slice(0, 7) } },
      { $group: { _id: null, points: { $sum: '$points' } } },
    ]) : [],
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

  const leaveTakenDays = (report.leaves?.taken ?? []).reduce((s, l) => s + (l.days || 0), 0);
  const pointsEarned = pointRows.reduce((s, p) => s + p.points, 0);

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
      pointRows: pointRows.map((p) => (p.toJSON ? p.toJSON() : p)),
    },

    // ── Where you are right now, whatever period is selected ──
    standing: {
      leave: report.leaves?.balance ?? null,
      // The yearly work-from-home allowance is a standing figure (Apr–Mar), not a
      // period one — "how many WFH days are left on Tuesday" isn't a thing.
      wfh: report.wfh ? { used: report.wfh.used, cap: report.wfh.cap, remaining: report.wfh.remaining } : null,
      duesPending: report.dues?.pending ?? 0,
      duesAdvance: report.dues?.advance ?? 0,
      tasksOpen: openNow,
      tasksOverdue: overdueNow,
      pointsThisMonth: monthPoints[0]?.points ?? 0,
      pointsMonth: today.slice(0, 7),
      rupeesPerPoint: settings.bonus?.rupeesPerPoint || 0,
    },
  };
}
