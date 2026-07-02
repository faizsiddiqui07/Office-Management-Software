import { Attendance } from '../models/Attendance.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { Task } from '../models/Task.js';
import { AuditLog } from '../models/AuditLog.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { companyDayFromYMD, ymdInTz } from '../lib/time.js';
import { can } from '../lib/permissions.js';
import { userWeekendDays } from '../lib/schedule.js';
import { computeWorkingDays } from './workingDays.service.js';
import { holidayYMDSet } from './holiday.service.js';
import { leaveYearOf } from '../lib/leaveYear.js';
import { getOrCreateBalance } from './leave.service.js';

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/**
 * Everything about ONE user for a date window [from, to] (YYYY-MM-DD), in one
 * payload: attendance counts + day-by-day, leaves + balance, to-do tasks, and
 * their activity log. Absent days are computed the same way the daily overview
 * does it — a working day (not weekend/holiday, up to today) with no check-in
 * and not on leave counts as absent.
 */
export async function getUserDossier(userId, { from, to }) {
  const user = await User.findById(userId);
  if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');

  const settings = await Setting.getSingleton();
  const today = ymdInTz(new Date());
  const cappedTo = to > today ? today : to; // don't count the future as absent

  // ---------------- Attendance ----------------
  const records = await Attendance.find({
    user: user._id,
    date: { $gte: companyDayFromYMD(from), $lte: companyDayFromYMD(to) },
  }).sort({ date: -1 });

  let presentDays = 0;
  let lateDays = 0;
  let excusedLateDays = 0;
  let onLeaveDays = 0;
  let totalWorkedMinutes = 0;
  let totalOvertimeMinutes = 0;
  const presentSet = new Set();
  const leaveSet = new Set();

  const attendanceRecords = records.map((r) => {
    const ymd = ymdInTz(r.date);
    totalWorkedMinutes += r.workedMinutes || 0;
    totalOvertimeMinutes += r.overtimeMinutes || 0;
    if (r.checkInAt) {
      presentDays += 1;
      presentSet.add(ymd);
    }
    if (r.status === 'LATE') {
      lateDays += 1;
      if (r.excused) excusedLateDays += 1;
    }
    if (r.status === 'ON_LEAVE') {
      onLeaveDays += 1;
      leaveSet.add(ymd);
    }
    return {
      id: r.id,
      dateYMD: ymd,
      checkInAt: r.checkInAt,
      checkOutAt: r.checkOutAt,
      workedMinutes: r.workedMinutes || 0,
      overtimeMinutes: r.overtimeMinutes || 0,
      status: r.status,
      excused: !!r.excused,
      lateReason: r.lateReason || null,
    };
  });

  // Roles that don't self-track attendance (e.g. leadership) are never counted
  // present/absent — mirrors the daily overview. Skip the absent math for them.
  const tracksAttendance = can({ role: user.role }, 'markAttendance');

  // Absent = working days (up to today) with no check-in and not on leave.
  let workingDates = [];
  if (tracksAttendance && from <= cappedTo) {
    const holidays = await holidayYMDSet(from, cappedTo);
    ({ workingDates } = computeWorkingDays({
      fromYMD: from,
      toYMD: cappedTo,
      weekendDays: userWeekendDays(user, settings), // part-timer's off-days aren't absences
      holidays,
    }));
  }
  let absentDays = 0;
  for (const ymd of workingDates) {
    if (!presentSet.has(ymd) && !leaveSet.has(ymd)) absentDays += 1;
  }

  const attendance = {
    tracksAttendance,
    presentDays,
    lateDays,
    excusedLateDays,
    absentDays,
    onLeaveDays,
    workingDays: workingDates.length,
    totalWorkedMinutes,
    totalOvertimeMinutes,
    records: attendanceRecords,
  };

  // ---------------- Leaves ----------------
  // Overlap semantics: a leave that merely TOUCHES the window counts (e.g. one
  // starting before `from` but ending inside it) — not just leaves that start inside.
  const leaveReqs = await LeaveRequest.find({
    user: user._id,
    startYMD: { $lte: to },
    endYMD: { $gte: from },
  }).sort({ startYMD: -1 });

  const approvedDays = leaveReqs
    .filter((l) => l.status === 'APPROVED')
    .reduce((s, l) => s + (l.workingDays || 0), 0);
  const pendingCount = leaveReqs.filter((l) => l.status === 'PENDING').length;
  const byType = {};
  for (const l of leaveReqs) {
    if (l.status === 'APPROVED') byType[l.type] = (byType[l.type] || 0) + (l.workingDays || 0);
  }

  const balYear = leaveYearOf(cappedTo || today);
  const bal = await getOrCreateBalance(user._id, balYear);
  const leaves = {
    balance: {
      year: balYear,
      totalQuota: bal.totalQuota,
      used: bal.used,
      remaining: bal.remaining,
      overtimeMinutes: bal.overtimeMinutes,
    },
    approvedDays,
    pendingCount,
    byType,
    requests: leaveReqs.map((l) => l.toJSON()),
  };

  // ---------------- Tasks (their own to-do) ----------------
  const dFrom = new Date(`${from}T00:00:00.000Z`);
  const dTo = new Date(`${to}T23:59:59.999Z`);
  const taskDocs = await Task.find({ owner: user._id, createdAt: { $gte: dFrom, $lte: dTo } })
    .sort({ createdAt: -1 })
    .limit(200)
    .populate('assignedBy', 'name');
  const taskList = taskDocs.map((t) => t.toJSON());
  const tasks = {
    total: taskList.length,
    pending: taskList.filter((t) => t.status === 'PENDING').length,
    done: taskList.filter((t) => t.status === 'DONE').length,
    overdue: taskList.filter((t) => t.status === 'PENDING' && t.dueYMD && t.dueYMD < today).length,
    items: taskList,
  };

  // ---------------- Activity ----------------
  const logs = await AuditLog.find({ actor: user._id, createdAt: { $gte: dFrom, $lte: dTo } })
    .sort({ createdAt: -1 })
    .limit(100);
  const activity = logs.map((a) => ({
    id: a._id.toString(),
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    meta: a.meta,
    createdAt: a.createdAt,
  }));

  return { user: user.toJSON(), range: { from, to }, attendance, leaves, tasks, activity };
}
