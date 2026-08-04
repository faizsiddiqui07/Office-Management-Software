import { Attendance } from '../models/Attendance.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { Expense } from '../models/Expense.js';
import { User } from '../models/User.js';
import { Role } from '../models/Role.js';
import { Task } from '../models/Task.js';
import { Setting } from '../models/Setting.js';
import { AuditLog } from '../models/AuditLog.js';
import { can } from '../lib/permissions.js';
import { roleLabel } from '../lib/roles.js';
import { companyDayFromYMD, ymdInTz } from '../lib/time.js';
import { APP_LIVE_YMD } from '../lib/appLive.js';
import { leaveYearOf } from '../lib/leaveYear.js';
import { getTodayPayload, attendanceOverview } from './attendance.service.js';
import { listHolidays, maybeAnnounceBirthdays } from './holiday.service.js';
import { balanceJSON } from './leave.service.js';
import { listVisible } from './announcement.service.js';
import { expenseSummary } from './expense.service.js';
import { computePeriod } from './report.service.js';

const COMPANY_TZ = 'Asia/Kolkata';

/**
 * The active users in the top-rank role — "CEO & President". Resolved by RANK, not by
 * a hardcoded key, so renaming the role never breaks it. A task only counts on the
 * task leaderboard if one of these people is involved in it (see taskLeaderboard).
 */
async function ownerTierUserIds() {
  const roles = await Role.find({}).select('key rank').lean();
  if (!roles.length) return [];
  const minRank = Math.min(...roles.map((r) => (typeof r.rank === 'number' ? r.rank : 100)));
  const topKeys = roles.filter((r) => (typeof r.rank === 'number' ? r.rank : 100) === minRank).map((r) => r.key);
  const users = await User.find({ role: { $in: topKeys }, isActive: true }).select('_id').lean();
  return users.map((u) => u._id);
}

/** [{ name, minutes }] — most overtime first, within a window of company-day instants. */
async function overtimeLeaderboard(fromDay, toDay) {
  const agg = await Attendance.aggregate([
    { $match: { date: { $gte: fromDay, $lte: toDay }, overtimeMinutes: { $gt: 0 } } },
    { $group: { _id: '$user', overtimeMinutes: { $sum: '$overtimeMinutes' } } },
    { $sort: { overtimeMinutes: -1 } },
    { $limit: 5 },
  ]);
  return withNames(agg, (o) => ({ overtimeMinutes: o.overtimeMinutes }));
}

/**
 * [{ name, count }] — who finished the most delegated work ON TIME.
 *
 * A completion counts only when ALL of these hold, and this is deliberately strict so
 * the board can't be gamed by handing out easy busywork:
 *   - the task was DELEGATED (assignedBy set) — your own to-dos don't count;
 *   - it had a due date, and was finished on or before it (a task with no deadline
 *     can't be "on time", so it's out);
 *   - a CEO & President is involved — they assigned it, originally assigned it before
 *     it was forwarded, or were TAGGED on it. A delegated task can now carry tagged
 *     colleagues (a CEO among them), so "leadership is in the loop" includes work they
 *     were tagged on — a senior still can't inflate a junior's rank with private
 *     busywork the leadership never sees.
 * Credit goes to whoever actually did it (completedBy), falling back to the owner.
 *
 * `range` is { from, to } YMD (this month) or null (all-time). Only the leaderboard
 * uses any of this — nothing else about tasks changes.
 *
 * `forwardedParentIds` are the tasks that were passed further down a chain. When a
 * junior finishes forwarded work, settleParent marks EVERY copy above it done and
 * credits the same doer — so counting each copy would score one piece of work two or
 * three times. Excluding the passed-on copies leaves only the copy actually worked, so
 * each real task counts once.
 */
async function taskLeaderboard(ceoIds, forwardedParentIds, range, graceDays = 0) {
  if (!ceoIds.length) return [];
  const agg = await Task.aggregate([
    {
      $match: {
        status: 'DONE',
        assignedBy: { $ne: null },
        dueYMD: { $ne: '' },
        completedAt: { $ne: null },
        _id: { $nin: forwardedParentIds }, // not a copy that was forwarded onward
        $or: [
          { assignedBy: { $in: ceoIds } },
          { originalAssignedBy: { $in: ceoIds } },
          { collaborators: { $in: ceoIds } }, // a CEO tagged on the delegated task
        ],
      },
    },
    // The day the work was DONE, in company time — the completion/approval day. For an
    // approval task that's when the assigner approved it, so a task approved after its due
    // date + grace counts as late, exactly how the bonus system and reports judge it.
    // `duePlus` shifts the due date forward by the grace days so the comparison is a plain
    // string ≤. IST throughout so it lines up with the due date's calendar, never a UTC day.
    {
      $addFields: {
        doneYMD: { $dateToString: { date: '$completedAt', format: '%Y-%m-%d', timezone: COMPANY_TZ } },
        duePlus: {
          $dateToString: {
            date: { $dateAdd: { startDate: { $dateFromString: { dateString: '$dueYMD', timezone: COMPANY_TZ } }, unit: 'day', amount: graceDays } },
            format: '%Y-%m-%d',
            timezone: COMPANY_TZ,
          },
        },
      },
    },
    {
      $match: {
        $expr: {
          $and: [
            { $lte: ['$doneYMD', '$duePlus'] }, // on or before the deadline + grace
            ...(range?.from ? [{ $gte: ['$doneYMD', range.from] }] : []),
            ...(range?.to ? [{ $lte: ['$doneYMD', range.to] }] : []),
          ],
        },
      },
    },
    { $group: { _id: { $ifNull: ['$completedBy', '$owner'] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ]);
  return withNames(agg, (o) => ({ count: o.count }));
}

/** Attach display names to an aggregation of { _id: userId, ... }. */
async function withNames(agg, extra) {
  if (!agg.length) return [];
  const users = await User.find({ _id: { $in: agg.map((o) => o._id) } }).select('name').lean();
  const nameOf = new Map(users.map((u) => [String(u._id), u.name]));
  return agg.map((o) => ({ name: nameOf.get(String(o._id)) ?? '—', ...extra(o) }));
}

/**
 * Who is out today + who's about to be — approved leave and WFH only. Shown to EVERYONE
 * on the dashboard so "is X in today?" needs no page hop. Absent (an unplanned no-show)
 * is deliberately excluded: it's derived, noisy before the day ends, and a management
 * concern leadership already sees on Team / analytics.
 */
export async function whosOut(todayYMD, settings) {
  const plus7 = new Date(`${todayYMD}T00:00:00Z`);
  plus7.setUTCDate(plus7.getUTCDate() + 7);
  const in7 = plus7.toISOString().slice(0, 10);

  const [leaveToday, wfhToday, upcoming] = await Promise.all([
    LeaveRequest.find({ status: 'APPROVED', type: { $ne: 'WFH' }, startYMD: { $lte: todayYMD }, endYMD: { $gte: todayYMD } }).populate('user', 'name').sort({ startYMD: 1 }),
    LeaveRequest.find({ status: 'APPROVED', type: 'WFH', startYMD: { $lte: todayYMD }, endYMD: { $gte: todayYMD } }).populate('user', 'name'),
    LeaveRequest.find({ status: 'APPROVED', type: { $ne: 'WFH' }, startYMD: { $gt: todayYMD, $lte: in7 } }).populate('user', 'name').sort({ startYMD: 1 }).limit(10),
  ]);

  const officeWfh = (settings.wfhDays || []).some((d) => d.ymd === todayYMD);
  return {
    onLeave: leaveToday.map((l) => ({ name: l.user?.name ?? '—', type: l.type })),
    // On an office-wide WFH day everyone is home — say it once, don't list 15 names.
    wfh: officeWfh ? [] : wfhToday.map((l) => l.user?.name ?? '—'),
    officeWfh,
    upcoming: upcoming.map((l) => ({ name: l.user?.name ?? '—', type: l.type, startYMD: l.startYMD })),
  };
}

/**
 * Task + overtime leaders for one period, so each dashboard card can be browsed
 * independently. `scope`: 'all' (all-time) or 'month' (a specific 'YYYY-MM', default the
 * current month). Same shape the dashboard's own leaderboards use.
 */
export async function leadersForPeriod({ scope = 'month', month } = {}) {
  const settings = await Setting.getSingleton();
  const graceDays = Math.max(0, settings.bonus?.graceDays ?? 1);
  const ceoIds = await ownerTierUserIds();
  const forwardedParentIds = await Task.distinct('forwardedFrom', { forwardedFrom: { $ne: null } });

  if (scope === 'all') {
    const [task, overtime] = await Promise.all([
      taskLeaderboard(ceoIds, forwardedParentIds, null, graceDays),
      overtimeLeaderboard(companyDayFromYMD(APP_LIVE_YMD), companyDayFromYMD(ymdInTz(new Date()))),
    ]);
    return { scope: 'all', label: 'All time', task, overtime };
  }

  const target = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : ymdInTz(new Date()).slice(0, 7);
  const p = computePeriod('monthly', `${target}-15`);
  const [task, overtime] = await Promise.all([
    taskLeaderboard(ceoIds, forwardedParentIds, { from: p.from, to: p.to }, graceDays),
    overtimeLeaderboard(companyDayFromYMD(p.from), companyDayFromYMD(p.to)),
  ]);
  return { scope: 'month', month: target, label: p.label, task, overtime };
}

export async function buildDashboard(user) {
  const settings = await Setting.getSingleton();
  const now = new Date();
  const todayYMD = ymdInTz(now);
  const year = leaveYearOf(todayYMD); // fiscal leave year (Apr 1 – Mar 31)
  const role = user.role;

  const out = { role, roleLabel: roleLabel(role), generatedAt: now.toISOString(), company: { name: settings.companyName, currency: settings.currency } };

  // Once a day (claimed atomically), push the team a birthday wish — best-effort, and
  // must never hold up or break the dashboard.
  maybeAnnounceBirthdays().catch((e) => console.error('birthday announce failed', e?.message));

  // ── Common (everyone) ─────────────────────────────────────
  out.today = await getTodayPayload(user);
  // balanceJSON, not the raw document: the "overtime banked" figure is derived from
  // the attendance days rather than read from a stored total nothing writes any more.
  out.balance = await balanceJSON(user._id, year);
  out.announcements = (await listVisible(user)).slice(0, 5);
  // Goes through the service so yearly repeats are expanded. Querying the table
  // directly showed a repeating 15 August only in its anchor year and then never again,
  // because the stored endYMD stays in the past forever. A year's horizon keeps
  // "the next five, whenever they are" true without an unbounded scan.
  out.upcomingHolidays = (await listHolidays({ from: todayYMD, to: `${Number(todayYMD.slice(0, 4)) + 1}-12-31` })).slice(0, 5);
  out.myPendingLeaves = (await LeaveRequest.find({ user: user._id, status: 'PENDING' }).sort({ appliedAt: -1 })).map((l) => l.toJSON());
  // Everyone sees who's on leave / WFH today (and who's out soon) — no role gate.
  out.whosOut = await whosOut(todayYMD, settings);

  const month = computePeriod('monthly', todayYMD);
  const monthStart = companyDayFromYMD(month.from);
  const monthEnd = companyDayFromYMD(month.to);

  // ── Leaderboards — shown to EVERYONE, no restriction ──────
  // Overtime is this month; task completions come both ways so the card can toggle
  // between this month and all-time without another request.
  const ceoIds = await ownerTierUserIds();
  const graceDays = Math.max(0, settings.bonus?.graceDays ?? 1);
  // Copies that were forwarded onward — excluded from the board so one forwarded piece
  // of work isn't counted once per link in its chain.
  const forwardedParentIds = await Task.distinct('forwardedFrom', { forwardedFrom: { $ne: null } });
  const [overtimeLeaders, taskLeadersMonth, taskLeadersAll] = await Promise.all([
    overtimeLeaderboard(monthStart, monthEnd),
    taskLeaderboard(ceoIds, forwardedParentIds, { from: month.from, to: month.to }, graceDays),
    taskLeaderboard(ceoIds, forwardedParentIds, null, graceDays),
  ]);
  out.leaderboards = {
    monthLabel: month.label,
    overtime: overtimeLeaders,
    taskMonth: taskLeadersMonth,
    taskAll: taskLeadersAll,
  };

  // Leadership holds BOTH viewEveryone and leadershipDashboard, and each block below
  // wanted the same roster — so the whole thing (every active user, the day's records,
  // settings, holidays) was built twice on the app's most-opened screen. Built once
  // here, only when somebody actually needs it.
  const needsOverview = can(user, 'viewEveryone') || can(user, 'leadershipDashboard');
  const overview = needsOverview ? await attendanceOverview(todayYMD) : null;

  // ── Manager+ (view everyone): team snapshot ───────────────
  if (can(user, 'viewEveryone')) {
    out.team = {
      total: overview.summary.total,
      // Everyone who showed up — including those working from home, who are working.
      // Without them an office-wide WFH day reads as nobody at work.
      present: overview.summary.present + overview.summary.late + (overview.summary.wfh || 0),
      late: Math.max(0, overview.summary.late - (overview.summary.excused || 0)), // excused = on-duty, not late
      absent: overview.summary.absent,
      onLeave: overview.summary.onLeave,
      wfh: overview.summary.wfh || 0,
      pendingApprovals: await LeaveRequest.countDocuments({ status: 'PENDING' }),
    };
    // team overtime this month
    const teamOt = await Attendance.aggregate([
      { $match: { date: { $gte: monthStart, $lte: monthEnd } } },
      { $group: { _id: null, overtime: { $sum: '$overtimeMinutes' } } },
    ]);
    out.team.overtimeMinutes = teamOt[0]?.overtime ?? 0;
  }

  // ── Expense viewers: month expense rollup ─────────────────
  if (can(user, 'viewExpenses')) {
    const sum = await expenseSummary({ from: month.from, to: month.to });
    out.expenses = { monthTotal: sum.total, count: sum.count, byCategory: sum.byCategory.slice(0, 6), currency: settings.currency };
  }

  // ── Leadership: rich analytics ────────────────────────────
  if (can(user, 'leadershipDashboard')) {
    const [headcount, dailySpend, openTasks, pendingApprovals, pendingApprovalsCount, recent] = await Promise.all([
      User.countDocuments({ isActive: true }),
      // This month's spend DAY BY DAY (the chart plots a line over the dates). A full
      // calendar year grouped by month left the chart all-but-empty — only the live
      // month has data — so it's the current month at daily resolution instead.
      Expense.aggregate([
        { $match: { dateYMD: { $gte: month.from, $lte: todayYMD } } },
        { $group: { _id: '$dateYMD', total: { $sum: '$amount' } } },
      ]),
      // Every still-open task across the company — the 4th analytics stat.
      Task.countDocuments({ status: 'PENDING' }),
      LeaveRequest.find({ status: 'PENDING' }).sort({ appliedAt: -1 }).limit(6).populate('user', 'name employeeId'),
      LeaveRequest.countDocuments({ status: 'PENDING' }),
      // Recent activity is the audit feed — only fetch it for users who may view the activity log.
      can(user, 'viewAudit')
        ? AuditLog.find().sort({ createdAt: -1 }).limit(10).populate('actor', 'name')
        : Promise.resolve([]),
    ]);

    // Fill every day from the 1st to today so the line is continuous, not a dot per day
    // that happened to have an expense.
    const spentByDay = new Map(dailySpend.map((d) => [d._id, d.total]));
    const dailyExpenseTrend = [];
    for (let t = Date.parse(`${month.from}T00:00:00Z`); ; t += 86400000) {
      const ymd = new Date(t).toISOString().slice(0, 10);
      if (ymd > todayYMD) break;
      dailyExpenseTrend.push({ ymd, total: spentByDay.get(ymd) ?? 0 });
    }

    out.analytics = {
      headcount,
      // Working from home is working — counted in the rate, shown as its own slice.
      attendanceRate: overview.summary.total
        ? Math.round(((overview.summary.present + overview.summary.late + (overview.summary.wfh || 0)) / overview.summary.total) * 100)
        : 0,
      breakdown: {
        present: overview.summary.present + (overview.summary.excused || 0), // on-duty counts as present
        late: Math.max(0, overview.summary.late - (overview.summary.excused || 0)),
        absent: overview.summary.absent,
        onLeave: overview.summary.onLeave,
        wfh: overview.summary.wfh || 0,
      },
      // The same list the common leaderboard already computed — no second query.
      overtimeLeaders: out.leaderboards.overtime,
      openTasks,
      dailyExpenseTrend,
      expenseMonthLabel: month.label, // the UI titles the chart from this
      pendingApprovalsCount, // real total (the list below is capped at 6 for preview)
      pendingApprovals: pendingApprovals.map((l) => ({
        id: l.id,
        name: l.user?.name ?? '—',
        type: l.type,
        startYMD: l.startYMD,
        endYMD: l.endYMD,
        days: l.workingDays,
      })),
      // Only present when the user may view the activity log (see fetch above).
      ...(can(user, 'viewAudit')
        ? {
            recentActivity: recent.map((a) => ({
              action: a.action,
              actor: a.actor?.name ?? 'System',
              entityType: a.entityType,
              createdAt: a.createdAt,
            })),
          }
        : {}),
    };
  }

  return out;
}
