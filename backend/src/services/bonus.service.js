import mongoose from 'mongoose';
import { Setting } from '../models/Setting.js';
import { PointEntry } from '../models/PointEntry.js';
import { User } from '../models/User.js';
import { Task } from '../models/Task.js';
import { Attendance } from '../models/Attendance.js';
import { ymdInTz, companyDayFromYMD, dayOfWeekInTz } from '../lib/time.js';
import { userWeekendDays } from '../lib/schedule.js';
import { holidayYMDSet } from './holiday.service.js';

const toId = (v) => (typeof v === 'string' ? new mongoose.Types.ObjectId(v) : v);

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/** Current month "YYYY-MM" in company time. */
export function currentMonth() {
  return ymdInTz(new Date()).slice(0, 7);
}

/** YMD + n days (n may be 0). */
function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (n || 0));
  return d.toISOString().slice(0, 10);
}

const rand = () => Math.random().toString(36).slice(2, 10);

/** The bonus config as a plain object (with safe defaults). */
export async function getConfig() {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  return {
    enabled: !!b.enabled,
    rupeesPerPoint: b.rupeesPerPoint || 0,
    graceDays: b.graceDays ?? 1,
    assignedTaskOnTime: b.assignedTaskOnTime || 0,
    assignedTaskLatePenalty: b.assignedTaskLatePenalty || 0,
    punctualStreakDays: b.punctualStreakDays || 10,
    punctualStreakPoints: b.punctualStreakPoints || 0,
    manualItems: (b.manualItems || []).map((m) => ({ id: m.id, label: m.label, points: m.points })),
  };
}

/** Leadership updates the whole config. Manual items get a stable id if missing. */
export async function updateConfig(patch) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const next = {
    enabled: patch.enabled !== undefined ? !!patch.enabled : b.enabled,
    rupeesPerPoint: Math.max(0, num(patch.rupeesPerPoint, b.rupeesPerPoint || 0)),
    graceDays: Math.max(0, num(patch.graceDays, b.graceDays ?? 1)),
    assignedTaskOnTime: Math.max(0, num(patch.assignedTaskOnTime, b.assignedTaskOnTime || 0)),
    assignedTaskLatePenalty: Math.max(0, num(patch.assignedTaskLatePenalty, b.assignedTaskLatePenalty || 0)),
    punctualStreakDays: Math.max(1, num(patch.punctualStreakDays, b.punctualStreakDays || 10)),
    punctualStreakPoints: Math.max(0, num(patch.punctualStreakPoints, b.punctualStreakPoints || 0)),
    manualItems: Array.isArray(patch.manualItems)
      ? patch.manualItems
          .filter((m) => m && String(m.label || '').trim())
          .slice(0, 100)
          .map((m) => ({ id: m.id || rand(), label: String(m.label).trim().slice(0, 80), points: num(m.points, 0) }))
      : (b.manualItems || []),
    lastPenaltyRun: b.lastPenaltyRun || '', // internal — preserved across edits
  };
  s.bonus = next;
  await s.save();
  return getConfig();
}

/** Sum of a user's points for a month. */
export async function userMonthTotal(userId, month = currentMonth()) {
  const agg = await PointEntry.aggregate([
    { $match: { user: toId(userId), month } },
    { $group: { _id: null, points: { $sum: '$points' } } },
  ]);
  return agg[0]?.points || 0;
}

/** A user's own summary for the header + rewards page. */
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
  const rules = [];
  if (cfg.assignedTaskOnTime) rules.push({ label: 'Finish a task assigned to you, on time', points: cfg.assignedTaskOnTime });
  if (cfg.assignedTaskLatePenalty) rules.push({ label: `Finish an assigned task late (after ${cfg.graceDays} grace day${cfg.graceDays === 1 ? '' : 's'})`, points: -Math.abs(cfg.assignedTaskLatePenalty) });
  if (cfg.punctualStreakPoints) rules.push({ label: `${cfg.punctualStreakDays} days in a row without being late`, points: cfg.punctualStreakPoints });
  return { enabled: cfg.enabled, rupeesPerPoint: cfg.rupeesPerPoint, autoRules: rules, manualItems: cfg.manualItems };
}

/** Leadership grants a manual award/penalty to a user. */
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

  const entry = await PointEntry.create({
    user: target._id,
    month: month || currentMonth(),
    points: Math.round(pts),
    reason: label.slice(0, 140),
    source: 'manual',
    awardedBy: actor._id,
  });
  return entry.toJSON();
}

/**
 * Delete an entry (undo a mistaken award / clear a penalty). Restricted to the
 * owner role — only CEO & President can take points back, not other leadership.
 */
export async function removeEntry(actor, id) {
  if (actor.role !== 'CEO_PRESIDENT') throw httpError(403, 'FORBIDDEN', 'Only CEO & President can delete points');
  const entry = await PointEntry.findById(id);
  if (!entry) throw httpError(404, 'NOT_FOUND', 'Entry not found');
  await entry.deleteOne();
  return { success: true };
}

/** Recent manual awards (across everyone) so leadership can review / undo them. */
export async function recentAwards(limit = 30) {
  const entries = await PointEntry.find({ source: 'manual' })
    .sort({ createdAt: -1 })
    .limit(Math.min(100, limit))
    .populate('user', 'name')
    .populate('awardedBy', 'name');
  return entries.map((e) => {
    const j = e.toJSON();
    return { id: j.id, points: j.points, reason: j.reason, month: j.month, createdAt: j.createdAt, user: j.user, awardedBy: j.awardedBy };
  });
}

/** Per-user totals for a month (leadership leaderboard). */
export async function leaderboard(month = currentMonth()) {
  const rows = await PointEntry.aggregate([
    { $match: { month } },
    { $group: { _id: '$user', points: { $sum: '$points' } } },
    { $sort: { points: -1 } },
  ]);
  const users = await User.find({ _id: { $in: rows.map((r) => r._id) } }).select('name role employeeId');
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const cfg = await getConfig();
  return rows
    .map((r) => {
      const u = byId.get(String(r._id));
      return u ? { id: String(u._id), name: u.name, employeeId: u.employeeId, role: u.role, points: r.points, rupees: cfg.rupeesPerPoint ? Math.round(r.points * cfg.rupeesPerPoint) : 0 } : null;
    })
    .filter(Boolean);
}

// ── Auto-award hooks (called from other services) ────────────────────────────

/**
 * Award/penalise the assignee when an ASSIGNED task is completed. Self-created
 * tasks earn nothing. Idempotent per task (re-completing replaces the entry).
 */
export async function onAssignedTaskDone(task) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled || !task.assignedBy) return;
  await PointEntry.deleteMany({ taskRef: task._id, source: 'auto_task' });

  const completedYMD = ymdInTz(task.completedAt || new Date());
  const late = task.dueYMD && completedYMD > addDays(task.dueYMD, b.graceDays || 0);
  let points = 0;
  let reason = '';
  if (late) {
    if (!b.assignedTaskLatePenalty) return;
    points = -Math.abs(b.assignedTaskLatePenalty);
    reason = `Late completion: ${task.title}`;
  } else {
    if (!b.assignedTaskOnTime) return;
    points = Math.abs(b.assignedTaskOnTime);
    reason = `Completed: ${task.title}`;
  }
  await PointEntry.create({ user: task.owner, month: completedYMD.slice(0, 7), points, reason, source: 'auto_task', taskRef: task._id });
}

/** Un-completing / deleting a task pulls back its auto award. */
export async function onAssignedTaskUndone(taskId) {
  await PointEntry.deleteMany({ taskRef: taskId, source: 'auto_task' });
}

/**
 * Punctual-streak award: run after an on-time check-in. Counts consecutive
 * on-time WORKING days ending today (within this month) and awards points each
 * time the streak reaches a multiple of `punctualStreakDays`. A late or absent
 * working day breaks the streak; weekends/holidays are skipped, not breaks.
 */
export async function onCheckIn(user, dateYMD) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled || !b.punctualStreakPoints) return;
  const N = Math.max(1, b.punctualStreakDays || 10);
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
    const isOff = offDays.includes(dow) || holidays.has(cur);
    if (!isOff) {
      if (byDay.get(cur) === 'PRESENT') streak += 1; // came on time
      else break; // late / absent / no record ends the streak
    }
    cur = ymdInTz(new Date(companyDayFromYMD(cur).getTime() - 86400000));
  }

  if (streak > 0 && streak % N === 0) {
    // A milestone is reached at most once a day — dedupe on today's date.
    const dayStart = companyDayFromYMD(dateYMD);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const already = await PointEntry.findOne({ user: user._id, source: 'auto_streak', createdAt: { $gte: dayStart, $lt: dayEnd } });
    if (!already) {
      await PointEntry.create({ user: user._id, month, points: Math.abs(b.punctualStreakPoints), reason: `${N}-day punctual streak`, source: 'auto_streak' });
    }
  }
}

/**
 * Penalise assigned tasks that are still open after their due date + grace days.
 * One penalty per task (idempotent); when the task is later completed the task
 * hook replaces it. Returns how many penalties were created.
 */
export async function runOverduePenalties() {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled || !b.assignedTaskLatePenalty) return 0;
  const today = ymdInTz(new Date());
  const grace = b.graceDays || 0;
  const tasks = await Task.find({ assignedBy: { $ne: null }, status: 'PENDING', dueYMD: { $ne: '' } }).select('owner dueYMD title');
  let created = 0;
  for (const t of tasks) {
    if (addDays(t.dueYMD, grace) >= today) continue; // still within due + grace
    const exists = await PointEntry.findOne({ taskRef: t._id, source: 'auto_task' });
    if (exists) continue;
    await PointEntry.create({ user: t.owner, month: today.slice(0, 7), points: -Math.abs(b.assignedTaskLatePenalty), reason: `Overdue: ${t.title}`, source: 'auto_task', taskRef: t._id });
    created += 1;
  }
  return created;
}

/** Run the overdue-task scan at most once a day (opportunistic, no cron needed). */
export async function maybeRunDaily() {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled) return;
  const today = ymdInTz(new Date());
  if (b.lastPenaltyRun === today) return;
  s.bonus.lastPenaltyRun = today; // set first so concurrent calls don't double-run
  await s.save();
  try { await runOverduePenalties(); } catch (e) { console.error('overdue scan failed', e?.message); }
}
