import mongoose from 'mongoose';
import { Setting } from '../models/Setting.js';
import { PointEntry } from '../models/PointEntry.js';
import { User } from '../models/User.js';
import { Task } from '../models/Task.js';
import { Attendance } from '../models/Attendance.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { can } from '../lib/permissions.js';
import { ymdInTz, companyDayFromYMD, dayOfWeekInTz } from '../lib/time.js';
import { userWeekendDays } from '../lib/schedule.js';
import { holidayYMDSet } from './holiday.service.js';

const toId = (v) => (typeof v === 'string' ? new mongoose.Types.ObjectId(v) : v);
const rand = () => Math.random().toString(36).slice(2, 10);

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/**
 * The catalog of AUTOMATIC rules the system can award on its own (each tied to
 * real, tracked data). Leadership picks which to switch on + their point value;
 * a rule the CEO hasn't added simply doesn't run. `sign` shows the intended
 * direction in the UI (points are stored as the CEO types them).
 */
export const AUTO_RULES = [
  { key: 'assignedTaskOnTime', label: 'Assigned task done on time', hint: 'Only tasks someone assigns — not self-made', sign: 'reward' },
  { key: 'assignedTaskLate', label: 'Assigned task done or left late', hint: 'After the due date + grace days', sign: 'penalty' },
  { key: 'punctualStreak', label: 'Punctual streak', hint: 'A run of on-time days (see “streak length”)', sign: 'reward' },
  { key: 'lateArrival', label: 'Each late arrival', hint: 'Every day they check in late', sign: 'penalty' },
  { key: 'overtimeHour', label: 'Each hour of overtime', hint: 'Per full hour worked past the shift', sign: 'reward' },
  { key: 'absentDay', label: 'Each absent day', hint: 'A working day with no attendance and no leave', sign: 'penalty' },
  { key: 'noLeaveMonth', label: 'No leave taken all month', hint: 'Awarded when the month ends', sign: 'reward' },
  { key: 'perfectAttendanceMonth', label: 'Perfect attendance all month', hint: 'No absent days and no late arrivals', sign: 'reward' },
];
const RULE_LABEL = Object.fromEntries(AUTO_RULES.map((r) => [r.key, r.label]));
const RULE_KEYS = new Set(AUTO_RULES.map((r) => r.key));

export function currentMonth() {
  return ymdInTz(new Date()).slice(0, 7);
}
function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (n || 0));
  return d.toISOString().slice(0, 10);
}
const prevDay = (ymd) => addDays(ymd, -1);
function prevMonth(ymOrToday) {
  const ym = String(ymOrToday).slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
const dayRange = (ymd) => { const start = companyDayFromYMD(ymd); return { start, end: new Date(start.getTime() + 86400000) }; };

/** Points configured for an auto rule (0 if the CEO hasn't switched it on). */
function rulePoints(bonus, key) {
  const r = (bonus?.autoRules || []).find((x) => x.key === key);
  return r ? Number(r.points) || 0 : 0;
}

// ── Config ───────────────────────────────────────────────────────────────────

export async function getConfig() {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  return {
    enabled: !!b.enabled,
    rupeesPerPoint: b.rupeesPerPoint || 0,
    graceDays: b.graceDays ?? 1,
    streakDays: b.streakDays || 10,
    autoRules: (b.autoRules || []).filter((r) => RULE_KEYS.has(r.key)).map((r) => ({ key: r.key, points: Number(r.points) || 0 })),
    manualItems: (b.manualItems || []).map((m) => ({ id: m.id, label: m.label, points: m.points })),
    catalog: AUTO_RULES, // so the UI can render labels + the "add rule" dropdown
  };
}

export async function updateConfig(patch) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  s.bonus = {
    enabled: patch.enabled !== undefined ? !!patch.enabled : b.enabled,
    rupeesPerPoint: Math.max(0, num(patch.rupeesPerPoint, b.rupeesPerPoint || 0)),
    graceDays: Math.max(0, num(patch.graceDays, b.graceDays ?? 1)),
    streakDays: Math.max(1, num(patch.streakDays, b.streakDays || 10)),
    autoRules: Array.isArray(patch.autoRules)
      ? patch.autoRules.filter((r) => r && RULE_KEYS.has(r.key)).map((r) => ({ key: r.key, points: Math.round(num(r.points, 0)) }))
      : (b.autoRules || []),
    manualItems: Array.isArray(patch.manualItems)
      ? patch.manualItems.filter((m) => m && String(m.label || '').trim()).slice(0, 100)
          .map((m) => ({ id: m.id || rand(), label: String(m.label).trim().slice(0, 80), points: Math.round(num(m.points, 0)) }))
      : (b.manualItems || []),
    lastPenaltyRun: b.lastPenaltyRun || '',
    lastMonthRollup: b.lastMonthRollup || '',
  };
  await s.save();
  return getConfig();
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function userMonthTotal(userId, month = currentMonth()) {
  const agg = await PointEntry.aggregate([
    { $match: { user: toId(userId), month } },
    { $group: { _id: null, points: { $sum: '$points' } } },
  ]);
  return agg[0]?.points || 0;
}

export async function mySummary(user, month = currentMonth()) {
  const cfg = await getConfig();
  const points = await userMonthTotal(user._id, month);
  const entries = await PointEntry.find({ user: user._id, month }).sort({ createdAt: -1 }).limit(200);
  return {
    enabled: cfg.enabled,
    month,
    points,
    rupees: cfg.rupeesPerPoint ? Math.round(points * cfg.rupeesPerPoint) : 0,
    rupeesPerPoint: cfg.rupeesPerPoint,
    entries: entries.map((e) => e.toJSON()),
  };
}

/** The public "price list" every staff member can see. */
export async function guide() {
  const cfg = await getConfig();
  const autoRules = cfg.autoRules
    .map((r) => {
      const meta = AUTO_RULES.find((x) => x.key === r.key);
      if (!meta || !r.points) return null;
      const signed = meta.sign === 'penalty' ? -Math.abs(r.points) : r.points;
      let label = meta.label;
      if (r.key === 'punctualStreak') label = `Punctual streak (${cfg.streakDays} days no late)`;
      return { label, points: signed };
    })
    .filter(Boolean);
  return { enabled: cfg.enabled, rupeesPerPoint: cfg.rupeesPerPoint, autoRules, manualItems: cfg.manualItems };
}

// ── Manual awards ────────────────────────────────────────────────────────────

export async function awardManual(actor, { userId, points, reason, itemId, month }) {
  const target = await User.findById(userId);
  if (!target) throw httpError(404, 'NOT_FOUND', 'That user was not found');
  let pts = Number(points);
  let label = String(reason || '').trim();
  if (itemId) {
    const cfg = await getConfig();
    const item = cfg.manualItems.find((m) => m.id === itemId);
    if (!item) throw httpError(400, 'BAD_ITEM', 'That reward item no longer exists');
    pts = item.points;
    if (!label) label = item.label;
  }
  if (!Number.isFinite(pts) || pts === 0) throw httpError(400, 'BAD_POINTS', 'Enter a non-zero points value');
  if (!label) throw httpError(400, 'BAD_REASON', 'Add a short reason');
  const entry = await PointEntry.create({ user: target._id, month: month || currentMonth(), points: Math.round(pts), reason: label.slice(0, 140), source: 'manual', awardedBy: actor._id });
  return entry.toJSON();
}

/** Delete an entry — OWNER (CEO & President) only. */
export async function removeEntry(actor, id) {
  if (actor.role !== 'CEO_PRESIDENT') throw httpError(403, 'FORBIDDEN', 'Only CEO & President can delete points');
  const entry = await PointEntry.findById(id);
  if (!entry) throw httpError(404, 'NOT_FOUND', 'Entry not found');
  await entry.deleteOne();
  return { success: true };
}

export async function recentAwards(limit = 30) {
  const entries = await PointEntry.find({ source: 'manual' }).sort({ createdAt: -1 }).limit(Math.min(100, limit)).populate('user', 'name').populate('awardedBy', 'name');
  return entries.map((e) => { const j = e.toJSON(); return { id: j.id, points: j.points, reason: j.reason, month: j.month, createdAt: j.createdAt, user: j.user, awardedBy: j.awardedBy }; });
}

export async function leaderboard(month = currentMonth()) {
  const rows = await PointEntry.aggregate([{ $match: { month } }, { $group: { _id: '$user', points: { $sum: '$points' } } }, { $sort: { points: -1 } }]);
  const users = await User.find({ _id: { $in: rows.map((r) => r._id) } }).select('name role employeeId');
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const cfg = await getConfig();
  return rows.map((r) => {
    const u = byId.get(String(r._id));
    return u ? { id: String(u._id), name: u.name, employeeId: u.employeeId, role: u.role, points: r.points, rupees: cfg.rupeesPerPoint ? Math.round(r.points * cfg.rupeesPerPoint) : 0 } : null;
  }).filter(Boolean);
}

// ── Event hooks (called from other services) ─────────────────────────────────

export async function onAssignedTaskDone(task) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled || !task.assignedBy) return;
  await PointEntry.deleteMany({ taskRef: task._id, source: 'auto_task' });
  const completedYMD = ymdInTz(task.completedAt || new Date());
  const late = task.dueYMD && completedYMD > addDays(task.dueYMD, b.graceDays || 0);
  const pts = rulePoints(b, late ? 'assignedTaskLate' : 'assignedTaskOnTime');
  if (!pts) return;
  await PointEntry.create({ user: task.owner, month: completedYMD.slice(0, 7), points: late ? -Math.abs(pts) : Math.abs(pts), reason: `${late ? 'Late completion' : 'Completed'}: ${task.title}`, source: 'auto_task', taskRef: task._id });
}

export async function onAssignedTaskUndone(taskId) {
  await PointEntry.deleteMany({ taskRef: taskId, source: 'auto_task' });
}

/** After a check-in: a late arrival is penalised; an on-time one may complete a streak. */
export async function onCheckIn(user, dateYMD, isLate) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled) return;

  if (isLate) {
    const pts = rulePoints(b, 'lateArrival');
    if (pts) {
      const reason = `Late arrival · ${dateYMD}`;
      if (!(await PointEntry.findOne({ user: user._id, source: 'auto_late', reason }))) {
        await PointEntry.create({ user: user._id, month: dateYMD.slice(0, 7), points: -Math.abs(pts), reason, source: 'auto_late' });
      }
    }
    return; // late breaks any streak
  }

  const streakPts = rulePoints(b, 'punctualStreak');
  if (!streakPts) return;
  const N = Math.max(1, b.streakDays || 10);
  const month = dateYMD.slice(0, 7);
  const monthStart = `${month}-01`;
  const recs = await Attendance.find({ user: user._id, date: { $gte: companyDayFromYMD(monthStart), $lte: companyDayFromYMD(dateYMD) } }).select('date status');
  const byDay = new Map(recs.map((r) => [ymdInTz(r.date), r.status]));
  const holidays = await holidayYMDSet(monthStart, dateYMD);
  const offDays = userWeekendDays(user, s);
  let streak = 0;
  let cur = dateYMD;
  while (cur >= monthStart) {
    const dow = dayOfWeekInTz(companyDayFromYMD(cur));
    if (!(offDays.includes(dow) || holidays.has(cur))) {
      if (byDay.get(cur) === 'PRESENT') streak += 1;
      else break;
    }
    cur = prevDay(cur);
  }
  if (streak > 0 && streak % N === 0) {
    const { start, end } = dayRange(dateYMD);
    if (!(await PointEntry.findOne({ user: user._id, source: 'auto_streak', createdAt: { $gte: start, $lt: end } }))) {
      await PointEntry.create({ user: user._id, month, points: Math.abs(streakPts), reason: `${N}-day punctual streak`, source: 'auto_streak' });
    }
  }
}

/** After a check-out: award points per full hour of overtime (replaces the day's OT entry). */
export async function onCheckOut(user, dateYMD, overtimeMinutes) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled) return;
  const pts = rulePoints(b, 'overtimeHour');
  // One overtime entry per day — clear any earlier one for this day, then re-add.
  const { start, end } = dayRange(dateYMD);
  await PointEntry.deleteMany({ user: user._id, source: 'auto_ot', createdAt: { $gte: start, $lt: end } });
  const hours = Math.floor((overtimeMinutes || 0) / 60);
  if (pts && hours > 0) {
    await PointEntry.create({ user: user._id, month: dateYMD.slice(0, 7), points: Math.abs(pts) * hours, reason: `Overtime · ${dateYMD} (${hours}h)`, source: 'auto_ot' });
  }
}

// ── Daily scans + month rollup (run opportunistically, no cron) ───────────────

async function scanOverdueTasks(b) {
  const pts = rulePoints(b, 'assignedTaskLate');
  if (!pts) return;
  const today = ymdInTz(new Date());
  const tasks = await Task.find({ assignedBy: { $ne: null }, status: 'PENDING', dueYMD: { $ne: '' } }).select('owner dueYMD title');
  for (const t of tasks) {
    if (addDays(t.dueYMD, b.graceDays || 0) >= today) continue;
    if (await PointEntry.findOne({ taskRef: t._id, source: 'auto_task' })) continue;
    await PointEntry.create({ user: t.owner, month: today.slice(0, 7), points: -Math.abs(pts), reason: `Overdue: ${t.title}`, source: 'auto_task', taskRef: t._id });
  }
}

async function scanAbsences(b) {
  const pts = rulePoints(b, 'absentDay');
  if (!pts) return;
  const yesterday = prevDay(ymdInTz(new Date()));
  const holidays = await holidayYMDSet(yesterday, yesterday);
  if (holidays.has(yesterday)) return;
  const s = await Setting.getSingleton();
  const dow = dayOfWeekInTz(companyDayFromYMD(yesterday));
  const users = (await User.find({ isActive: true }).select('name role employmentType schedule')).filter((u) => can({ role: u.role }, 'markAttendance'));
  const day = companyDayFromYMD(yesterday);
  const present = new Set((await Attendance.find({ date: day }).select('user')).map((r) => String(r.user)));
  const onLeave = new Set((await LeaveRequest.find({ status: 'APPROVED', startYMD: { $lte: yesterday }, endYMD: { $gte: yesterday } }).select('user')).map((l) => String(l.user)));
  const month = yesterday.slice(0, 7);
  for (const u of users) {
    if (userWeekendDays(u, s).includes(dow)) continue;
    if (present.has(String(u._id)) || onLeave.has(String(u._id))) continue;
    const reason = `Absent · ${yesterday}`;
    if (await PointEntry.findOne({ user: u._id, source: 'auto_absent', reason })) continue;
    await PointEntry.create({ user: u._id, month, points: -Math.abs(pts), reason, source: 'auto_absent' });
  }
}

/** Month-end awards for the just-finished month (no-leave, perfect attendance). */
async function runMonthRollup(b) {
  const thisMonth = currentMonth();
  const done = b.lastMonthRollup;
  const target = prevMonth(thisMonth);
  if (done === target) return target; // already processed
  const noLeavePts = rulePoints(b, 'noLeaveMonth');
  const perfectPts = rulePoints(b, 'perfectAttendanceMonth');
  if (!noLeavePts && !perfectPts) return target;

  const from = `${target}-01`;
  const lastDay = new Date(Date.UTC(Number(target.slice(0, 4)), Number(target.slice(5, 7)), 0)).getUTCDate();
  const monthEnd = `${target}-${String(lastDay).padStart(2, '0')}`;
  const s = await Setting.getSingleton();
  const holidays = await holidayYMDSet(from, monthEnd);
  const users = (await User.find({ isActive: true }).select('name role employmentType schedule')).filter((u) => can({ role: u.role }, 'markAttendance'));

  for (const u of users) {
    // no-leave award
    if (noLeavePts) {
      const took = await LeaveRequest.countDocuments({ user: u._id, status: 'APPROVED', startYMD: { $lte: monthEnd }, endYMD: { $gte: from } });
      if (took === 0 && !(await PointEntry.findOne({ user: u._id, month: target, source: 'auto_noleave' }))) {
        await PointEntry.create({ user: u._id, month: target, points: Math.abs(noLeavePts), reason: 'No leave taken all month', source: 'auto_noleave' });
      }
    }
    // perfect-attendance award: no absent working days + no unexcused late
    if (perfectPts) {
      const recs = await Attendance.find({ user: u._id, date: { $gte: companyDayFromYMD(from), $lte: companyDayFromYMD(monthEnd) } }).select('date status excused');
      const byDay = new Map(recs.map((r) => [ymdInTz(r.date), r]));
      const offDays = userWeekendDays(u, s);
      let absent = 0;
      let lateBad = 0;
      let workingDays = 0;
      for (let d = 1; d <= lastDay; d += 1) {
        const ymd = `${target}-${String(d).padStart(2, '0')}`;
        const dow = dayOfWeekInTz(companyDayFromYMD(ymd));
        if (offDays.includes(dow) || holidays.has(ymd)) continue;
        workingDays += 1;
        const rec = byDay.get(ymd);
        if (!rec) absent += 1;
        else if (rec.status === 'LATE' && !rec.excused) lateBad += 1;
        else if (rec.status === 'ABSENT') absent += 1;
      }
      if (workingDays > 0 && absent === 0 && lateBad === 0 && !(await PointEntry.findOne({ user: u._id, month: target, source: 'auto_perfect' }))) {
        await PointEntry.create({ user: u._id, month: target, points: Math.abs(perfectPts), reason: 'Perfect attendance all month', source: 'auto_perfect' });
      }
    }
  }
  return target;
}

/** Runs the daily scans + month rollup at most once a day (no cron needed). */
export async function maybeRunDaily() {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled) return;
  const today = ymdInTz(new Date());
  if (b.lastPenaltyRun === today) return;
  s.bonus.lastPenaltyRun = today; // throttle first
  const rolled = await runMonthRollup(b).catch((e) => { console.error('month rollup failed', e?.message); return b.lastMonthRollup; });
  if (rolled) s.bonus.lastMonthRollup = rolled;
  await s.save();
  try { await scanOverdueTasks(b); } catch (e) { console.error('overdue scan failed', e?.message); }
  try { await scanAbsences(b); } catch (e) { console.error('absence scan failed', e?.message); }
}
