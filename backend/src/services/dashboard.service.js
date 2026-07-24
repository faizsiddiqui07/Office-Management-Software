import { Attendance } from '../models/Attendance.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { LeaveBalance } from '../models/LeaveBalance.js';
import { User } from '../models/User.js';
import { Role } from '../models/Role.js';
import { Task } from '../models/Task.js';
import { Setting } from '../models/Setting.js';
import { AuditLog } from '../models/AuditLog.js';
import { can } from '../lib/permissions.js';
import { roleLabel } from '../lib/roles.js';
import { companyDayFromYMD, ymdInTz } from '../lib/time.js';
import { leaveYearOf } from '../lib/leaveYear.js';
import { getTodayPayload, attendanceOverview } from './attendance.service.js';
import { listHolidays } from './holiday.service.js';
import { getOrCreateBalance } from './leave.service.js';
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
 *     it was forwarded, or are tagged on it. A senior can't inflate a junior's rank
 *     with private busywork; leadership has to be in the loop.
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
async function taskLeaderboard(ceoIds, forwardedParentIds, range) {
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
          { collaborators: { $in: ceoIds } },
        ],
      },
    },
    // The day the work was DONE, in company time. For an approval-gated task that's the
    // submit day, not the approval day — the doer met the deadline when they submitted,
    // and an approver sitting on it must not turn an on-time task late. Matches how the
    // bonus system judges the same thing. Both this and the month window use IST so they
    // line up with the due date's calendar, never a UTC day that could shift.
    { $addFields: { doneYMD: { $dateToString: { date: { $ifNull: ['$submittedAt', '$completedAt'] }, format: '%Y-%m-%d', timezone: COMPANY_TZ } } } },
    {
      $match: {
        $expr: {
          $and: [
            { $lte: ['$doneYMD', '$dueYMD'] }, // on or before the deadline
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

export async function buildDashboard(user) {
  const settings = await Setting.getSingleton();
  const now = new Date();
  const todayYMD = ymdInTz(now);
  const year = leaveYearOf(todayYMD); // fiscal leave year (Apr 1 – Mar 31)
  const role = user.role;

  const out = { role, roleLabel: roleLabel(role), generatedAt: now.toISOString(), company: { name: settings.companyName, currency: settings.currency } };

  // ── Common (everyone) ─────────────────────────────────────
  out.today = await getTodayPayload(user);
  out.balance = (await getOrCreateBalance(user._id, year)).toJSON();
  out.announcements = (await listVisible(user)).slice(0, 5);
  // Goes through the service so yearly repeats are expanded. Querying the table
  // directly showed a repeating 15 August only in its anchor year and then never again,
  // because the stored endYMD stays in the past forever. A year's horizon keeps
  // "the next five, whenever they are" true without an unbounded scan.
  out.upcomingHolidays = (await listHolidays({ from: todayYMD, to: `${Number(todayYMD.slice(0, 4)) + 1}-12-31` })).slice(0, 5);
  out.myPendingLeaves = (await LeaveRequest.find({ user: user._id, status: 'PENDING' }).sort({ appliedAt: -1 })).map((l) => l.toJSON());

  const month = computePeriod('monthly', todayYMD);
  const monthStart = companyDayFromYMD(month.from);
  const monthEnd = companyDayFromYMD(month.to);

  // ── Leaderboards — shown to EVERYONE, no restriction ──────
  // Overtime is this month; task completions come both ways so the card can toggle
  // between this month and all-time without another request.
  const ceoIds = await ownerTierUserIds();
  // Copies that were forwarded onward — excluded from the board so one forwarded piece
  // of work isn't counted once per link in its chain.
  const forwardedParentIds = await Task.distinct('forwardedFrom', { forwardedFrom: { $ne: null } });
  const [overtimeLeaders, taskLeadersMonth, taskLeadersAll] = await Promise.all([
    overtimeLeaderboard(monthStart, monthEnd),
    taskLeaderboard(ceoIds, forwardedParentIds, { from: month.from, to: month.to }),
    taskLeaderboard(ceoIds, forwardedParentIds, null),
  ]);
  out.leaderboards = {
    monthLabel: month.label,
    overtime: overtimeLeaders,
    taskMonth: taskLeadersMonth,
    taskAll: taskLeadersAll,
  };

  // ── Manager+ (view everyone): team snapshot ───────────────
  if (can(user, 'viewEveryone')) {
    const overview = await attendanceOverview(todayYMD);
    out.team = {
      total: overview.summary.total,
      present: overview.summary.present + overview.summary.late, // everyone who showed up
      late: Math.max(0, overview.summary.late - (overview.summary.excused || 0)), // excused = on-duty, not late
      absent: overview.summary.absent,
      onLeave: overview.summary.onLeave,
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
    const overview = await attendanceOverview(todayYMD);
    // Expenses run on the CALENDAR year (the chart is titled with it) — the
    // fiscal `year` above is only for leave balances.
    const calendarYear = Number(todayYMD.slice(0, 4));
    const [headcount, balances, yearExpenses, pendingApprovals, pendingApprovalsCount, recent] = await Promise.all([
      User.countDocuments({ isActive: true }),
      LeaveBalance.find({ year }),
      expenseSummary({ from: `${calendarYear}-01-01`, to: `${calendarYear}-12-31` }),
      LeaveRequest.find({ status: 'PENDING' }).sort({ appliedAt: -1 }).limit(6).populate('user', 'name employeeId'),
      LeaveRequest.countDocuments({ status: 'PENDING' }),
      // Recent activity is the audit feed — only fetch it for users who may view the activity log.
      can(user, 'viewAudit')
        ? AuditLog.find().sort({ createdAt: -1 }).limit(10).populate('actor', 'name')
        : Promise.resolve([]),
    ]);

    out.analytics = {
      headcount,
      attendanceRate: overview.summary.total ? Math.round(((overview.summary.present + overview.summary.late) / overview.summary.total) * 100) : 0,
      breakdown: {
        present: overview.summary.present + (overview.summary.excused || 0), // on-duty counts as present
        late: Math.max(0, overview.summary.late - (overview.summary.excused || 0)),
        absent: overview.summary.absent,
        onLeave: overview.summary.onLeave,
      },
      // The same list the common leaderboard already computed — no second query.
      overtimeLeaders: out.leaderboards.overtime,
      leaveUtilization: {
        used: balances.reduce((s, b) => s + b.used, 0),
        total: balances.reduce((s, b) => s + b.totalQuota, 0),
      },
      monthlyExpenseTrend: yearExpenses.byMonth,
      monthlyExpenseTrendYear: calendarYear, // the UI titles the chart from this
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
