import mongoose from 'mongoose';
import { Setting } from '../models/Setting.js';
import { PointEntry } from '../models/PointEntry.js';
import { User } from '../models/User.js';
import { ymdInTz } from '../lib/time.js';

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

/** Leadership deletes an entry (undo a mistaken award, or clear a penalty). */
export async function removeEntry(_actor, id) {
  const entry = await PointEntry.findById(id);
  if (!entry) throw httpError(404, 'NOT_FOUND', 'Entry not found');
  await entry.deleteOne();
  return { success: true };
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
