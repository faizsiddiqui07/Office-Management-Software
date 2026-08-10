import { Attendance } from '../models/Attendance.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { LeaveBalance } from '../models/LeaveBalance.js';
import { Expense } from '../models/Expense.js';
import { Task } from '../models/Task.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { companyDayFromYMD, ymdInTz, formatCompany } from '../lib/time.js';
import { roleLabel } from '../lib/roles.js';
import { splitByJoining, periodStartFor, joinedYMD } from '../lib/joining.js';
import { can } from '../lib/permissions.js';
import { workWindowClosed, userWeekendDays } from '../lib/schedule.js';
import { leaveYearOf } from '../lib/leaveYear.js';
import { holidayYMDSet } from './holiday.service.js';
import { expenseSummary } from './expense.service.js';
import { ledgerFor } from './dues.service.js';
import { wfhUsage } from './leave.service.js';
import { periodPoints, ratesForPeriod } from './bonus.service.js';
import { APP_LIVE_YMD } from '../lib/appLive.js';

const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function niceDate(ymd) {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function computePeriod(type, dateYMD, range) {
  if (type === 'custom') {
    // An arbitrary "x date → y date" window. Fall back to the single date if a
    // side is missing, and always keep from <= to.
    let from = range?.from || dateYMD;
    let to = range?.to || range?.from || dateYMD;
    if (to < from) [from, to] = [to, from];
    return { from, to, label: from === to ? niceDate(from) : `${niceDate(from)} – ${niceDate(to)}` };
  }
  const d = new Date(`${dateYMD}T00:00:00Z`);
  if (type === 'daily') {
    return { from: dateYMD, to: dateYMD, label: niceDate(dateYMD) };
  }
  if (type === 'weekly') {
    // Weeks are counted within the month — 1–7, 8–14, 15–21, 22–28, then whatever is
    // left. Calendar (Mon–Sun) weeks straddle month ends, so a "weekly" report for
    // early July would open on 29 June and read as an arbitrary window; anchoring to
    // the month keeps every report lined up with the month it belongs to.
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth();
    const day = d.getUTCDate();
    const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const startDay = Math.floor((day - 1) / 7) * 7 + 1;
    const endDay = Math.min(startDay + 6, lastDay);
    const from = `${y}-${pad(mo + 1)}-${pad(startDay)}`;
    const to = `${y}-${pad(mo + 1)}-${pad(endDay)}`;
    return { from, to, label: `${niceDate(from)} – ${niceDate(to)}` };
  }
  if (type === 'monthly') {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return {
      from: `${y}-${pad(m + 1)}-01`,
      to: `${y}-${pad(m + 1)}-${pad(last)}`,
      label: new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    };
  }
  if (type === 'quarterly') {
    // Quarters run with the FISCAL year, not the calendar: Q1 is Apr–Jun. A quarter
    // that straddled the year end would make every quarterly total un-addable to the
    // yearly one.
    const y0 = d.getUTCFullYear();
    const m0 = d.getUTCMonth(); // 0-11
    const fy = m0 + 1 >= 4 ? y0 : y0 - 1;
    const q = Math.floor(((m0 - 3 + 12) % 12) / 3); // 0-3, Apr–Jun = 0
    const startMonth = 3 + q * 3; // months since Jan of the fiscal year's start
    const start = new Date(Date.UTC(fy, startMonth, 1));
    const end = new Date(Date.UTC(fy, startMonth + 3, 0)); // day 0 = last day of the previous month
    const ymd = (x) => `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
    return { from: ymd(start), to: ymd(end), label: `Q${q + 1} FY ${fy}–${String(fy + 1).slice(2)}` };
  }
  // Yearly = the company FISCAL year (Apr 1 – Mar 31), matching leave + expenses.
  const y0 = d.getUTCFullYear();
  const fy = d.getUTCMonth() + 1 >= 4 ? y0 : y0 - 1;
  return { from: `${fy}-04-01`, to: `${fy + 1}-03-31`, label: `FY ${fy}–${String(fy + 1).slice(2)} (Apr–Mar)` };
}

/**
 * The same period, one step earlier — for "up 18% vs last month".
 *
 * Steps the ANCHOR back and re-resolves, so the answer is always a real calendar
 * month/quarter/fiscal year. Subtracting the current period's length instead would
 * put "the month before July" at 31 May – 21 Jun, and February would be worse.
 * A custom window has no calendar predecessor, so it shifts by its own span.
 */
export function previousPeriod(type, dateYMD, range) {
  const cur = computePeriod(type, dateYMD, range);
  if (type === 'custom') {
    const from = new Date(`${cur.from}T00:00:00Z`);
    const to = new Date(`${cur.to}T00:00:00Z`);
    const span = Math.round((to - from) / 86400000) + 1;
    const prevTo = new Date(from.getTime() - 86400000);
    const prevFrom = new Date(prevTo.getTime() - (span - 1) * 86400000);
    const ymd = (x) => x.toISOString().slice(0, 10);
    return { from: ymd(prevFrom), to: ymd(prevTo), label: `previous ${span} days` };
  }
  const d = new Date(`${cur.from}T00:00:00Z`);
  const step = { daily: 0, weekly: 0, monthly: 1, quarterly: 3 }[type];
  const back =
    type === 'daily'
      ? new Date(d.getTime() - 86400000)
      : type === 'weekly'
        ? new Date(d.getTime() - 7 * 86400000)
        : step
          ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - step, 1))
          : new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), 1)); // yearly
  return computePeriod(type, back.toISOString().slice(0, 10), range);
}

function countWorkingDays(fromYMD, toYMD, weekendDays, holidaySet) {
  if (toYMD < fromYMD) return 0;
  let count = 0;
  let d = new Date(`${fromYMD}T00:00:00Z`);
  const end = new Date(`${toYMD}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    const ymd = d.toISOString().slice(0, 10);
    if (!weekendDays.includes(d.getUTCDay()) && !holidaySet.has(ymd)) count += 1;
    d = new Date(d.getTime() + 86400000);
  }
  return count;
}

const round1 = (n) => Math.round(n * 10) / 10;

export async function buildReport(type, dateYMD, range) {
  const settings = await Setting.getSingleton();
  const period = computePeriod(type, dateYMD, range);
  const { from, to } = period;

  const fromDay = companyDayFromYMD(from);
  const toDay = companyDayFromYMD(to);
  const now = new Date();
  const todayYMD = ymdInTz(now);
  // Today only becomes an "absent-countable" working day once the office day is
  // over — until then a no-show may still turn up. So measure up to the last
  // FINISHED working day (yesterday while today's company hours are still on).
  const companyClosed = formatCompany(now, 'HH:mm') >= settings.workEnd;
  const lastFinishedYMD = companyClosed ? todayYMD : ymdInTz(new Date(now.getTime() - 86400000));
  const elapsedTo = to < lastFinishedYMD ? to : lastFinishedYMD;
  const holidaySet = await holidayYMDSet(from, to);
  const workingDays = from > elapsedTo ? 0 : countWorkingDays(from, elapsedTo, settings.weekendDays, holidaySet);

  const [activeUsers, records, takenLeaves, pendingLeaves, balances, expList, expSummary] = await Promise.all([
    // schedule + employmentType so a part-timer's own working days are used, not the
    // office weekend (which marked their off-days absent).
    User.find({ isActive: true }).select('name employeeId role department dateOfJoining schedule employmentType').sort({ name: 1 }),
    // Fetch up to the report's end OR today, whichever is earlier. A current/ongoing
    // period reaches to today so a person whose own office day has already ended is
    // counted for it (each employee's numerator is capped to their last-finished day
    // below); a PAST period stops at `to` instead of dragging in a year of rows it
    // would only discard.
    Attendance.find({ date: { $gte: fromDay, $lte: companyDayFromYMD(to < todayYMD ? to : todayYMD) } }),
    // WFH is excluded from every leave list and count: it rides on the same collection
    // but it is not leave, and counting it would inflate "days taken" across the report.
    LeaveRequest.find({ status: 'APPROVED', type: { $ne: 'WFH' }, startYMD: { $lte: to }, endYMD: { $gte: from } }).populate('user', 'name employeeId'),
    LeaveRequest.find({ status: 'PENDING', type: { $ne: 'WFH' } }).populate('user', 'name employeeId').sort({ appliedAt: -1 }),
    LeaveBalance.find({ year: leaveYearOf(from) }).populate('user', 'name employeeId'),
    Expense.find({ dateYMD: { $gte: from, $lte: to } }).sort({ dateYMD: -1 }).limit(300).populate('addedBy', 'name'),
    expenseSummary({ from, to }),
  ]);

  // Leadership don't clock in or apply for leave — keep them OUT of the attendance
  // table and the leave-balance table, otherwise they read as permanently "absent"
  // or as unused quota, which is nonsense. (They still appear in the roster.)
  const attendanceRoster = activeUsers.filter((u) => can({ role: u.role }, 'markAttendance'));
  // Nobody is accountable for a period they hadn't joined. People who arrived after it
  // drop out entirely; those who arrived during it are judged only on their own days,
  // so the report never counts a day against someone who had no access.
  // Split on the days that have HAPPENED (today included), not on the last FINISHED day.
  // Using the finished day pushed anyone whose joining date is today into "joined later"
  // on today's own report — a person told they arrived after the day they arrived.
  const countToCompany = to < todayYMD ? to : todayYMD;
  const { included: attendanceUsers, joinedLater } = splitByJoining(attendanceRoster, from, countToCompany || to);
  const leaveUserIds = new Set(activeUsers.filter((u) => can({ role: u.role }, 'applyLeave')).map((u) => String(u._id)));

  // ── Attendance per employee ───────────────────────────────
  // Keep each person's rows (with their company-day) so the counts can be capped to
  // that person's OWN last-finished working day — a custom-hours employee's day may end
  // before or after the office's, and the company and self reports have to agree.
  const recsByUser = new Map();
  for (const r of records) {
    const uid = String(r.user);
    if (!recsByUser.has(uid)) recsByUser.set(uid, []);
    recsByUser.get(uid).push(r);
  }
  const yesterdayYMD = ymdInTz(new Date(now.getTime() - 86400000));

  const perEmployee = attendanceUsers.map((u) => {
    const uWeekend = userWeekendDays(u, settings); // their own off-days (part-time safe)
    // Their own last FINISHED working day: today if their office hours are over, else
    // yesterday — then capped to the report window.
    const uFinished = workWindowClosed(u, todayYMD, settings, now) ? todayYMD : yesterdayYMD;
    const uElapsedTo = to < uFinished ? to : uFinished;
    const startedOn = periodStartFor(u, from);
    // TWO windows, deliberately different, because two different kinds of question are
    // being asked:
    //  • uCountTo (today) — what HAS happened: working days so far, attendance, the rate.
    //  • uElapsedTo (last finished day) — a judgement that needs the day to be over: absent.
    // They used to be conflated: attendance was counted to today but working days stopped
    // at yesterday, so the rate divided a today-inclusive numerator by a yesterday-inclusive
    // denominator — a daily report opened this morning read "0% / 0 working days" beside 25
    // people present, and a monthly one read 114%.
    const uCountTo = to < todayYMD ? to : todayYMD;
    const ownWorkingDays = startedOn > uCountTo ? 0 : countWorkingDays(startedOn, uCountTo, uWeekend, holidaySet);
    const finishedWorkingDays = startedOn > uElapsedTo ? 0 : countWorkingDays(startedOn, uElapsedTo, uWeekend, holidaySet);
    // Is this day one of THIS person's working days at all? Coming in on a Sunday, on a
    // holiday, or before they joined is real and is shown — but it must never enter a
    // figure whose denominator excludes those days. Without this test every off-day
    // attendance cancelled one real absence (and could push the rate past 100%).
    const isOwnWorkingDay = (d) => d >= startedOn
      && !holidaySet.has(d)
      && !uWeekend.includes(new Date(`${d}T00:00:00Z`).getUTCDay());

    let present = 0;
    let late = 0;
    let onLeave = 0;
    let wfh = 0;
    let workedMinutes = 0;
    let overtimeMinutes = 0;
    // Recorded facts are counted up to TODAY — a check-in that already happened is real
    // even while the office day is still running. (This is what makes the DAILY report
    // show today's attendance instead of a blank table: the old cap at the last
    // FINISHED day silently dropped every row of an in-progress today.) Judgements that
    // need a finished day — absent — still cap at uElapsedTo via the *Fin counters.
    const countTo = uCountTo;
    let showedFin = 0;
    let onLeaveFin = 0;
    let wfhFin = 0;
    let showedWD = 0; // attendance ON this person's working days — the rate's numerator
    let wfhWD = 0;
    let offDayPresent = 0; // came in on a Sunday / holiday: real, but not a working day
    for (const r of recsByUser.get(String(u._id)) || []) {
      const d = ymdInTz(new Date(r.date));
      if (d > countTo) continue;
      const finished = d <= uElapsedTo;
      const workingDay = isOwnWorkingDay(d);
      workedMinutes += r.workedMinutes || 0;
      overtimeMinutes += r.overtimeMinutes || 0;
      if (r.status === 'PRESENT' || r.status === 'LATE') {
        if (r.status === 'LATE' && !r.excused) late += 1;
        present += 1; // every attended day, off-day work included (matches the payroll matrix)
        if (workingDay) {
          showedWD += 1;
          if (finished) showedFin += 1;
        } else {
          offDayPresent += 1;
        }
      } else if (r.status === 'ON_LEAVE') {
        onLeave += r.halfDayLeave ? 0.5 : 1; // half-day leave = half a day away
        if (workingDay && finished) onLeaveFin += r.halfDayLeave ? 0.5 : 1;
      } else if (r.status === 'WFH') {
        wfh += 1; // worked, from home
        if (workingDay) {
          wfhWD += 1;
          if (finished) wfhFin += 1;
        } else {
          offDayPresent += 1;
        }
      }
    }
    const showed = present;
    // WFH days were WORKED, so they are neither absent nor leave — subtract them or every
    // work-from-home day silently reads as an absence. Absent is judged ONLY on FINISHED
    // working days, and only working-day attendance may cancel one: an off-day check-in
    // used to eat a real absence one-for-one, so a month with two Sunday visits and two
    // no-shows reported "Absent 0" while the payroll matrix reported 2.
    const absent = Math.max(0, finishedWorkingDays - showedFin - onLeaveFin - wfhFin);
    return {
      name: u.name,
      joinedYMD: joinedYMD(u),
      startedOn: startedOn > from ? startedOn : '',
      workingDays: ownWorkingDays,
      employeeId: u.employeeId,
      role: u.role,
      roleLabel: roleLabel(u.role),
      // A late employee still showed up — Present counts every attended day;
      // `late` is the "of which came late" indicator, not a separate bucket.
      present: showed,
      // Of `present`, how many fell on a day that wasn't theirs to work. Surfaced so
      // Present, Working days and Absent can be reconciled by a reader.
      offDayPresent,
      late,
      absent,
      onLeave,
      wfh,
      // Attendance counted ONLY on working days — what the rate divides.
      showedWorkingDays: showedWD,
      wfhWorkingDays: wfhWD,
      // Raw minutes so the display can show "3h 48m" (like overtime); workedHours (the
      // decimal) is kept for any older consumer.
      workedMinutes,
      workedHours: round1(workedMinutes / 60),
      overtimeMinutes,
    };
  });

  const totals = perEmployee.reduce(
    (acc, e) => {
      acc.present += e.present;
      acc.late += e.late;
      acc.absent += e.absent;
      acc.onLeave += e.onLeave;
      acc.wfh += e.wfh;
      acc.workedMinutes += e.workedMinutes;
      acc.overtimeMinutes += e.overtimeMinutes;
      return acc;
    },
    { present: 0, late: 0, absent: 0, onLeave: 0, wfh: 0, workedMinutes: 0, overtimeMinutes: 0 },
  );
  totals.workedHours = round1(totals.workedMinutes / 60);
  // Sum each person's own working days rather than headcount × period, so a mid-period
  // joiner doesn't drag the company attendance rate down for days they weren't here.
  const denom = perEmployee.reduce((n, e) => n + (e.workingDays ?? workingDays), 0);
  // Numerator and denominator describe the SAME set of days: this person's working days,
  // up to today. `present` on its own can't be used — it includes days that aren't in the
  // denominator at all (a Sunday visit), which is what let the rate print 114%.
  const rateNumerator = perEmployee.reduce((n, e) => n + e.showedWorkingDays + e.wfhWorkingDays, 0);
  // null, not 0, when there is nothing to divide — a period with no working day in it yet
  // (a Sunday-only report) isn't "0% attendance", it's a question with no answer.
  totals.attendanceRate = denom > 0 ? Math.round((rateNumerator / denom) * 100) : null;

  // ── Leaves ────────────────────────────────────────────────
  const leaves = {
    taken: takenLeaves.map((l) => ({
      name: l.user?.name ?? '—',
      employeeId: l.user?.employeeId ?? '',
      type: l.type,
      startYMD: l.startYMD,
      endYMD: l.endYMD,
      days: l.workingDays,
    })),
    pending: pendingLeaves.map((l) => ({
      name: l.user?.name ?? '—',
      type: l.type,
      startYMD: l.startYMD,
      endYMD: l.endYMD,
      days: l.workingDays,
    })),
    balances: balances
      .filter((b) => b.user && leaveUserIds.has(String(b.user._id)))
      .map((b) => ({
        name: b.user?.name ?? '—',
        employeeId: b.user?.employeeId ?? '',
        used: b.used,
        remaining: b.remaining,
        total: b.totalQuota,
      })),
  };

  // ── Expenses ──────────────────────────────────────────────
  const expenses = {
    total: expSummary.total,
    count: expSummary.count,
    // The itemised list is capped (the totals/category figures above are NOT), so the
    // PDF can say "showing latest N of M" rather than a list that silently doesn't add
    // up to the stated total.
    listCount: expList.length,
    listCapped: expSummary.count > expList.length,
    currency: settings.currency,
    byCategory: expSummary.byCategory,
    list: expList.map((e) => ({
      title: e.title,
      vendor: e.vendor,
      category: e.category,
      paymentMethod: e.paymentMethod,
      amount: e.amount,
      dateYMD: e.dateYMD,
    })),
  };

  // ── Roster ────────────────────────────────────────────────
  const byRole = {};
  for (const u of activeUsers) byRole[u.role] = (byRole[u.role] || 0) + 1;
  const roster = {
    headcount: activeUsers.length,
    byRole,
    members: activeUsers.map((u) => ({ name: u.name, employeeId: u.employeeId, role: u.role, roleLabel: roleLabel(u.role), department: u.department })),
  };

  // ── Tasks, person by person ───────────────────────────────
  // Who got through how much work in this period, and how much of it landed on time.
  //
  // Judged exactly the way the bonus system and the leaderboard judge it, so the three
  // never tell different stories: a task counts on the day it was SUBMITTED when it
  // needed approval (a slow sign-off must not turn on-time work late), otherwise on the
  // day it was completed; and "late" allows the configured grace days.
  //
  // Only DELEGATED work counts — the same rule points use. Someone's private to-do list
  // is theirs to keep, not company output. Copies that were forwarded onward are left
  // out too: finishing at the bottom of a chain closes every copy above it, and one
  // piece of work should be counted once, for whoever actually did it.
  const graceDays = Math.max(0, settings.bonus?.graceDays ?? 1);
  const plusDays = (ymd, n) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const forwardedParentIds = await Task.distinct('forwardedFrom', { forwardedFrom: { $ne: null } });
  const [doneTasks, taggedTasks] = await Promise.all([
    Task.find({
      status: 'DONE',
      assignedBy: { $ne: null },
      completedAt: { $ne: null },
      _id: { $nin: forwardedParentIds },
    }).select('owner completedBy dueYMD completedAt submittedAt requiresApproval'),
    // Tagged: work RAISED in this period that named them as a colleague. It is somebody
    // else's task, so it is reported beside the figures above, never inside them.
    Task.find({ collaborators: { $ne: [] }, createdAt: { $gte: new Date(`${from}T00:00:00.000Z`), $lte: new Date(`${to}T23:59:59.999Z`) } }).select('owner collaborators'),
  ]);

  const taskRow = new Map(); // userId → { done, onTime, late, tagged }
  const rowFor = (id) => {
    const k = String(id);
    if (!taskRow.has(k)) taskRow.set(k, { done: 0, onTime: 0, late: 0, tagged: 0 });
    return taskRow.get(k);
  };
  for (const t of doneTasks) {
    // The completion/approval day decides which period a task lands in AND whether it was
    // late — the same rule the bonus engine and leaderboard use.
    const doneYMD = ymdInTz(t.completedAt);
    if (doneYMD < from || doneYMD > to) continue; // finished outside this period
    const row = rowFor(t.completedBy || t.owner); // credit whoever actually did it
    row.done += 1;
    // A task with no due date can't be late — it's counted as on time, exactly the way
    // the bonus engine scores it (onAssignedTaskDone treats a missing dueYMD as on time).
    // This also makes the columns reconcile: on time + late always equals done, so a task
    // never silently vanishes between the totals.
    if (t.dueYMD && doneYMD > plusDays(t.dueYMD, graceDays)) row.late += 1;
    else row.onTime += 1;
  }
  for (const t of taggedTasks) {
    for (const c of t.collaborators || []) {
      if (String(c) === String(t.owner)) continue; // their own task isn't "tagged on"
      rowFor(c).tagged += 1;
    }
  }

  const taskPerEmployee = activeUsers
    .map((u) => ({
      name: u.name,
      employeeId: u.employeeId,
      role: u.role,
      roleLabel: roleLabel(u.role),
      ...(taskRow.get(String(u._id)) || { done: 0, onTime: 0, late: 0, tagged: 0 }),
    }))
    // Most work done first — the table reads as a picture of the period, not a directory.
    .sort((a, b) => b.done - a.done || b.onTime - a.onTime || a.name.localeCompare(b.name));

  const tasks = {
    perEmployee: taskPerEmployee,
    totals: taskPerEmployee.reduce(
      (acc, r) => ({ done: acc.done + r.done, onTime: acc.onTime + r.onTime, late: acc.late + r.late, tagged: acc.tagged + r.tagged }),
      { done: 0, onTime: 0, late: 0, tagged: 0 },
    ),
    graceDays,
  };

  // ── Rewards / bonus points, person by person ──────────────
  // The same figures the Rewards page + leaderboard show for this period: a full month is
  // the NET standing (that month's points + any carried-in deficit); any other window is
  // the raw points earned on days inside it. Omitted entirely when the scheme is off.
  const rp = await periodPoints({ type, from, to });
  let rewards = null;
  if (rp.enabled) {
    const perEmployeeR = activeUsers
      .map((u) => {
        const points = rp.byUser.get(String(u._id)) || 0;
        return {
          name: u.name,
          employeeId: u.employeeId,
          role: u.role,
          roleLabel: roleLabel(u.role),
          points,
          // Payout is for a positive standing only; a deficit carries, it never pays a negative wage.
          rupees: rp.rupeesPerPoint && points > 0 ? Math.round(points * rp.rupeesPerPoint) : 0,
        };
      })
      // Most points first — a leaderboard-style ordering, not a directory.
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    rewards = {
      enabled: true,
      rupeesPerPoint: rp.rupeesPerPoint,
      monthlyNet: type === 'monthly', // true = month NET (carry-in), else raw earned in-window
      // The price list this period was actually scored on. Rule values are effective-dated,
      // so a later change can't re-price these figures — printing the rates alongside them
      // is what makes an old report checkable instead of just asserted. More than one row
      // means the values changed part-way through the window.
      rates: await ratesForPeriod(from, to),
      perEmployee: perEmployeeR,
      totals: perEmployeeR.reduce(
        (acc, e) => ({ points: acc.points + e.points, rupees: acc.rupees + e.rupees }),
        { points: 0, rupees: 0 },
      ),
    };
  }

  // No dues in the company report at all — not even totals. What the office is owed
  // is the admin's ledger, not company reporting. Each person still sees their own
  // entry by entry in their own report, and the Dues page administers them.

  return {
    scope: 'company',
    type,
    date: dateYMD,
    period,
    // When the period hasn't finished yet, everything above only counts days up
    // to `asOfYMD` (today) — upcoming days are NOT counted as absent.
    ongoing: to > todayYMD,
    // What the figures cover. Absences are judged only up to the last FINISHED day
    // (`absentAsOfYMD`); everything else — attendance, working days, the rate — covers
    // today too, because those are facts that have already happened.
    asOfYMD: countToCompany,
    absentAsOfYMD: elapsedTo,
    generatedAt: new Date().toISOString(),
    company: { name: settings.companyName, currency: settings.currency, timezone: settings.timezone, brandColor: settings.brandColor, ...(await Setting.getLogos()) },
    workingDays,
    // People left out of this report because they joined after it — surfaced so a
    // short list reads as "they weren't here yet", not as missing data.
    joinedLater,
    tasks,
    rewards, // null when the bonus scheme is off
    attendance: { perEmployee, totals },
    leaves,
    expenses,
    roster,
  };
}

const STATUS_LABEL = {
  PRESENT: 'Present',
  LATE: 'Present (late)',
  ON_DUTY: 'On-duty',
  ABSENT: 'Absent',
  ON_LEAVE: 'On leave',
  WFH: 'Work from home',
  HOLIDAY: 'Holiday',
  WEEKEND: 'Weekend',
  BEFORE_JOINING: 'Not employed yet',
  UPCOMING: '—',
};

/**
 * A single person's own report (attendance day-by-day, leaves, dues) for a period.
 * Available to any signed-in user for THEIR OWN data.
 */
export async function buildSelfReport({ user, type, dateYMD, range }) {
  const settings = await Setting.getSingleton();
  const period = computePeriod(type, dateYMD, range);
  const { from, to } = period;
  const now = new Date();
  const todayYMD = ymdInTz(now);
  const fromDay = companyDayFromYMD(from);
  const toDay = companyDayFromYMD(to);
  const holidaySet = await holidayYMDSet(from, to);
  // THIS person's own off-days — the office weekend, or a part-timer's own schedule.
  // Using the office weekend for everyone marked a part-timer absent on their own days.
  const weekendDays = userWeekendDays(user, settings);
  const joinedOn = joinedYMD(user); // days before this never count for or against them

  // Tasks OWNED by this person that were raised in the window — for the stats block.
  const dFrom = new Date(`${from}T00:00:00.000Z`);
  const dTo = new Date(`${to}T23:59:59.999Z`);
  const [records, takenLeaves, pendingLeaves, balanceDoc, due, taskDocs, taggedDocs, wfhReqs, wfhAllowance] = await Promise.all([
    Attendance.find({ user: user._id, date: { $gte: fromDay, $lte: toDay } }),
    // Leave only — WFH is reported separately (no balance, and the day was worked).
    LeaveRequest.find({ user: user._id, status: 'APPROVED', type: { $ne: 'WFH' }, startYMD: { $lte: to }, endYMD: { $gte: from } }).sort({ startYMD: -1 }),
    LeaveRequest.find({ user: user._id, status: 'PENDING', type: { $ne: 'WFH' } }).sort({ appliedAt: -1 }),
    LeaveBalance.findOne({ user: user._id, year: leaveYearOf(from) }),
    ledgerFor(user._id),
    Task.find({ owner: user._id, createdAt: { $gte: dFrom, $lte: dTo } }).select('status dueYMD completedAt submittedAt requiresApproval assignedBy'),
    // Work they were only TAGGED on — somebody else's task. Counted apart from their own
    // figures, never inside them: being kept in the loop is not doing the work.
    Task.find({ collaborators: user._id, owner: { $ne: user._id }, createdAt: { $gte: dFrom, $lte: dTo } }).select('status dueYMD completedAt submittedAt requiresApproval'),
    // Their own WFH requests touching this period, plus the fiscal-year allowance —
    // which is a standing figure, so it is anchored to the leave year, never the
    // (possibly one-day) report window.
    LeaveRequest.find({ user: user._id, type: 'WFH', startYMD: { $lte: to }, endYMD: { $gte: from } }).sort({ startYMD: -1 }),
    wfhUsage(user._id, leaveYearOf(from)),
  ]);

  // ── Day-by-day attendance ─────────────────────────────────
  const byYmd = new Map();
  // Key by the COMPANY-timezone day (records store the TZ-midnight instant);
  // using UTC here would shift check-ins to the wrong calendar day.
  for (const r of records) byYmd.set(ymdInTz(new Date(r.date)), r);

  const days = [];
  let cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur.getTime() <= end.getTime()) {
    const ymd = cur.toISOString().slice(0, 10);
    const dow = cur.getUTCDay();
    const weekday = cur.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
    const rec = byYmd.get(ymd);
    let status;
    let checkIn = '';
    let checkOut = '';
    let workedHours = 0;
    let workedMinutes = 0;
    let overtimeMinutes = 0;
    // A work-from-home day approved in ADVANCE already has its row, but it hasn't been
    // worked yet — counting it would put a future day in the attendance rate and make
    // this report disagree with the company one, which only counts finished days.
    // A row for a day that HASN'T ARRIVED is not something that happened. Approving a
    // leave writes its ON_LEAVE rows for every date at once, including weeks ahead, and
    // those used to be tallied as elapsed days: a leave approved on the 6th for the 17th
    // made a report run on the 10th claim eleven working days inside the first ten days
    // of the month, at a 55% rate instead of 100%.
    if (rec && ymd > todayYMD) {
      status = 'UPCOMING';
    } else if (rec && rec.status === 'WFH' && !workWindowClosed(user, ymd, settings, now)) {
      // Work from home approved in advance for TODAY: the row exists, the day isn't worked yet.
      status = 'UPCOMING';
    } else if (rec) {
      status = rec.status === 'LATE' && rec.excused ? 'ON_DUTY' : rec.status;
      if (rec.checkInAt) checkIn = formatCompany(rec.checkInAt, 'HH:mm');
      if (rec.checkOutAt) checkOut = formatCompany(rec.checkOutAt, 'HH:mm');
      workedMinutes = rec.workedMinutes || 0;
      workedHours = round1(workedMinutes / 60);
      overtimeMinutes = rec.overtimeMinutes || 0;
    } else if (holidaySet.has(ymd)) {
      status = 'HOLIDAY';
    } else if (ymd < joinedOn || ymd < APP_LIVE_YMD) {
      // Days before this person had access aren't theirs to answer for — and neither
      // are days before the office ran on this system at all. The fiscal year opens on
      // 1 April but nothing was recorded until 1 July, so without this a yearly report
      // for anyone with a genuine older joining date would mark three months absent
      // for days that were simply never tracked.
      status = 'BEFORE_JOINING';
    } else if (weekendDays.includes(dow)) {
      status = 'WEEKEND';
    } else if (!workWindowClosed(user, ymd, settings, now)) {
      // Future days, and today before the office day is over — not absent yet.
      status = 'UPCOMING';
    } else {
      status = 'ABSENT';
    }
    const halfDayLeave = status === 'ON_LEAVE' && !!rec?.halfDayLeave;
    const statusLabel = halfDayLeave ? 'On leave (half day)' : STATUS_LABEL[status] || status;
    // Was this day one of THIS person's working days, by the CALENDAR — regardless of what
    // happened on it? Derived here rather than from `status`, because a Sunday they came in
    // on carries status PRESENT and would otherwise be counted as a working day.
    const isWorkingDay = ymd >= joinedOn && ymd >= APP_LIVE_YMD && !holidaySet.has(ymd)
      && !weekendDays.includes(dow) && ymd <= todayYMD;
    days.push({ ymd, weekday, status, statusLabel, halfDayLeave, isWorkingDay, checkIn, checkOut, workedHours, workedMinutes, overtimeMinutes });
    cur = new Date(cur.getTime() + 86400000);
  }

  const tally = (s) => days.filter((d) => d.status === s).length;
  const late = tally('LATE');
  const onDuty = tally('ON_DUTY');
  // A late day is still an attended day — Present counts every day they showed
  // up; `late` stays as the "of which came late" indicator.
  const present = tally('PRESENT') + late + onDuty;
  // A half-day leave is half a day away and half a day unaccounted for — the same split
  // the company report and the payroll matrix make. Counting it as a whole day on leave
  // had this one document disagreeing with those two, and with its own row, which
  // already reads "On leave (half day)".
  const halfLeaveDays = days.filter((d) => d.halfDayLeave).length;
  const absent = tally('ABSENT') + halfLeaveDays * 0.5;
  const onLeave = tally('ON_LEAVE') - halfLeaveDays * 0.5;
  // Worked, from home. Counted as a working day (or the denominator silently shrinks
  // and the day vanishes from the report altogether) and as attended in the rate.
  const wfh = tally('WFH');
  // Counted off the CALENDAR, not by adding up statuses. Summing present+absent+onLeave+wfh
  // let an off-day visit invent a working day — a July with two Sunday check-ins reported 29
  // working days in a 27-working-day month, and a rate to match.
  const workingDays = days.filter((d) => d.isWorkingDay).length;
  // Attendance that fell on an actual working day — the rate's numerator, so it can never
  // exceed its own denominator. Off-day work is still shown (in `present`), just not here.
  const ATTENDED = ['PRESENT', 'LATE', 'ON_DUTY', 'WFH'];
  const attendedWorkingDays = days.filter((d) => d.isWorkingDay && ATTENDED.includes(d.status)).length;
  const offDayPresent = days.filter((d) => !d.isWorkingDay && ATTENDED.includes(d.status)).length;
  const attTotals = {
    present,
    late,
    onDuty,
    absent,
    onLeave,
    wfh,
    offDayPresent,
    holidays: tally('HOLIDAY'),
    weekends: tally('WEEKEND'),
    workingDays,
    // Raw minutes (for the "3h 48m" display) plus the decimal for any older consumer.
    // Sum the raw minutes then round ONCE — matching the company report. Rounding each
    // day to 0.1h first and then adding drifted the total by up to ~1h over a month, so
    // the same person's worked hours differed between their own report and the company's.
    workedMinutes: records.reduce((s, r) => s + (r.workedMinutes || 0), 0),
    workedHours: round1(records.reduce((s, r) => s + (r.workedMinutes || 0), 0) / 60),
    overtimeMinutes: days.reduce((s, d) => s + d.overtimeMinutes, 0),
    // WFH days sit in workingDays and were worked, so they belong in the numerator too.
    // null (not 0) when the period holds no working day yet — see the company report.
    attendanceRate: workingDays > 0 ? Math.round((attendedWorkingDays / workingDays) * 100) : null,
  };

  // ── Leaves ────────────────────────────────────────────────
  const leaves = {
    taken: takenLeaves.map((l) => ({ type: l.type, startYMD: l.startYMD, endYMD: l.endYMD, days: l.workingDays, reason: l.reason || '' })),
    pending: pendingLeaves.map((l) => ({ type: l.type, startYMD: l.startYMD, endYMD: l.endYMD, days: l.workingDays })),
    balance: balanceDoc
      ? { used: balanceDoc.used, remaining: balanceDoc.remaining, total: balanceDoc.totalQuota }
      : { used: 0, remaining: settings.annualLeaveQuota, total: settings.annualLeaveQuota },
  };

  // ── Dues (current balance + entries in the period) ────────
  // `pending`/`advance` are the LIFETIME balance as it stands TODAY — only `entries` is
  // scoped to the period. Labelling the balance with the period made the document
  // contradict itself: a July report showed "Rs 4,500 due · July 2026" over a table
  // holding one Rs 1,500 row, the other Rs 3,000 having been raised in May. The date is
  // shipped so both the card and the PDF can say what the figure is actually as of.
  const dues = {
    balanceAsOfYMD: todayYMD,
    currency: settings.currency,
    pending: due.pending,
    advance: due.advance,
    entries: due.entries
      .filter((e) => e.dateYMD >= from && e.dateYMD <= to)
      .map((e) => ({
        dateYMD: e.dateYMD,
        kind: e.kind,
        item: e.item || '',
        source: e.source || '',
        amount: e.amount,
        status: e.kind === 'DUE' ? e.status : 'PAYMENT',
        note: e.note || '',
      })),
  };

  // ── Task stats (totals only, no list) ─────────────────────
  // On-time = completed on or before the due date + grace, judged from the day it was
  // actually finished — the approval day for an approval task — the same rule the
  // leaderboard, the bonus system and the company report use. A task with no due date
  // can't be late, so it counts as on time; this keeps done = on time + late.
  const graceDaysSelf = Math.max(0, settings.bonus?.graceDays ?? 1);
  const plusDaysSelf = (ymd, n) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const tallyTasks = (docs) => {
    const st = { total: docs.length, pending: 0, done: 0, onTime: 0, late: 0, overdue: 0 };
    for (const t of docs) {
      if (t.status === 'DONE') {
        st.done += 1;
        const doneYMD = ymdInTz(t.completedAt || new Date());
        if (t.dueYMD && doneYMD > plusDaysSelf(t.dueYMD, graceDaysSelf)) st.late += 1;
        else st.onTime += 1;
      } else {
        st.pending += 1;
        if (t.dueYMD && t.dueYMD < todayYMD) st.overdue += 1;
      }
    }
    return st;
  };
  // The headline figures stay what this person OWNS, split so the delegated work — the
  // kind that counts and earns points — can be read on its own. Tagged work is somebody
  // else's task: reported beside these, never added into them.
  const taskStats = {
    ...tallyTasks(taskDocs),
    assigned: tallyTasks(taskDocs.filter((t) => t.assignedBy)),
    personal: tallyTasks(taskDocs.filter((t) => !t.assignedBy)),
    tagged: tallyTasks(taggedDocs),
  };

  return {
    scope: 'me',
    type,
    date: dateYMD,
    period,
    // Ongoing period: day-by-day marks future days as "Upcoming" (not absent);
    // the totals above only cover days up to `asOfYMD` (today).
    ongoing: to > todayYMD,
    asOfYMD: to < todayYMD ? to : todayYMD,
    generatedAt: new Date().toISOString(),
    company: { name: settings.companyName, currency: settings.currency, timezone: settings.timezone, brandColor: settings.brandColor, ...(await Setting.getLogos()) },
    subject: { name: user.name, employeeId: user.employeeId, role: user.role, roleLabel: roleLabel(user.role), department: user.department || '' },
    attendance: { days, totals: attTotals },
    tasks: taskStats,
    leaves,
    // Work from home: what happened in this period, plus where they stand for the year.
    // `officeWide` days are counted from the ATTENDANCE rows (the office declares those
    // without a request), which is also why they never touch the allowance.
    wfh: {
      ...wfhAllowance,
      daysInPeriod: attTotals.wfh,
      officeWideDays: records.filter((r) => r.status === 'WFH' && r.wfhOfficeWide).length,
      requests: wfhReqs.map((l) => ({ startYMD: l.startYMD, status: l.status, reason: l.reason || '' })),
    },
    dues,
  };
}
