import { Attendance } from '../models/Attendance.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { LeaveBalance } from '../models/LeaveBalance.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { Holiday } from '../models/Holiday.js';
import { AuditLog } from '../models/AuditLog.js';
import { can } from '../lib/permissions.js';
import { roleLabel } from '../lib/roles.js';
import { companyDayFromYMD, ymdInTz } from '../lib/time.js';
import { leaveYearOf } from '../lib/leaveYear.js';
import { getTodayPayload, attendanceOverview } from './attendance.service.js';
import { getOrCreateBalance } from './leave.service.js';
import { listVisible } from './announcement.service.js';
import { expenseSummary } from './expense.service.js';
import { computePeriod } from './report.service.js';

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
  out.upcomingHolidays = (await Holiday.find({ endYMD: { $gte: todayYMD } }).sort({ startYMD: 1 }).limit(5)).map((h) => h.toJSON());
  out.myPendingLeaves = (await LeaveRequest.find({ user: user._id, status: 'PENDING' }).sort({ appliedAt: -1 })).map((l) => l.toJSON());

  const month = computePeriod('monthly', todayYMD);
  const monthStart = companyDayFromYMD(month.from);
  const monthEnd = companyDayFromYMD(month.to);

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
    const [headcount, otAgg, balances, yearExpenses, pendingApprovals, pendingApprovalsCount, recent] = await Promise.all([
      User.countDocuments({ isActive: true }),
      Attendance.aggregate([
        { $match: { date: { $gte: monthStart, $lte: monthEnd }, overtimeMinutes: { $gt: 0 } } },
        { $group: { _id: '$user', overtimeMinutes: { $sum: '$overtimeMinutes' } } },
        { $sort: { overtimeMinutes: -1 } },
        { $limit: 5 },
      ]),
      LeaveBalance.find({ year }),
      expenseSummary({ from: `${calendarYear}-01-01`, to: `${calendarYear}-12-31` }),
      LeaveRequest.find({ status: 'PENDING' }).sort({ appliedAt: -1 }).limit(6).populate('user', 'name employeeId'),
      LeaveRequest.countDocuments({ status: 'PENDING' }),
      // Recent activity is the audit feed — only fetch it for users who may view the activity log.
      can(user, 'viewAudit')
        ? AuditLog.find().sort({ createdAt: -1 }).limit(10).populate('actor', 'name')
        : Promise.resolve([]),
    ]);

    const otUsers = await User.find({ _id: { $in: otAgg.map((o) => o._id) } }).select('name');
    const otMap = new Map(otUsers.map((u) => [String(u._id), u.name]));

    out.analytics = {
      headcount,
      attendanceRate: overview.summary.total ? Math.round(((overview.summary.present + overview.summary.late) / overview.summary.total) * 100) : 0,
      breakdown: {
        present: overview.summary.present + (overview.summary.excused || 0), // on-duty counts as present
        late: Math.max(0, overview.summary.late - (overview.summary.excused || 0)),
        absent: overview.summary.absent,
        onLeave: overview.summary.onLeave,
      },
      overtimeLeaders: otAgg.map((o) => ({ name: otMap.get(String(o._id)) ?? '—', overtimeMinutes: o.overtimeMinutes })),
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
