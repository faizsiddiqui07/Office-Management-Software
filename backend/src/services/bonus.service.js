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
import { hadAccessOn, splitByJoining, periodStartFor } from '../lib/joining.js';
import { APP_LIVE_YMD } from '../lib/appLive.js';
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
  { key: 'punctualStreak', label: 'Punctual week', hint: 'On time all week (Mon–Sat); leave / WFH / Sunday don’t break it', sign: 'reward' },
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
    autoRules: (b.autoRules || []).filter((r) => RULE_KEYS.has(r.key)).map((r) => ({ key: r.key, points: Number(r.points) || 0 })),
    manualItems: (b.manualItems || []).map((m) => ({ id: m.id, label: m.label, points: m.points })),
    catalog: AUTO_RULES, // so the UI can render labels + the "add rule" dropdown
  };
}

export async function updateConfig(patch) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  // Switching the scheme ON starts it from today, never from the past.
  //
  // The daily job treats "the previous month hasn't been rolled up" and "yesterday
  // hasn't been scanned" as work to do. On a first enable that meant the month just
  // gone — a closed month nobody had been told the rules for — was awarded in full
  // (everyone with no approved leave in it collected the no-leave points), and
  // yesterday could hand out absence penalties. Marking both as already handled at
  // the moment it's turned on means the first thing it scores is today onward.
  // Only the FIRST time it's ever switched on. A later pause-and-resume must not skip
  // the month in between: those months were scored, and voiding a rollup that is
  // legitimately still owed would quietly cost everybody their month-end award.
  const neverRun = !b.lastMonthRollup && !b.lastPenaltyRun;
  const turningOn = patch.enabled !== undefined && !!patch.enabled && !b.enabled && neverRun;
  const today = ymdInTz(new Date());
  s.bonus = {
    enabled: patch.enabled !== undefined ? !!patch.enabled : b.enabled,
    rupeesPerPoint: Math.max(0, num(patch.rupeesPerPoint, b.rupeesPerPoint || 0)),
    graceDays: Math.max(0, num(patch.graceDays, b.graceDays ?? 1)),
    autoRules: Array.isArray(patch.autoRules)
      ? patch.autoRules.filter((r) => r && RULE_KEYS.has(r.key)).map((r) => ({ key: r.key, points: Math.round(num(r.points, 0)) }))
      : (b.autoRules || []),
    manualItems: Array.isArray(patch.manualItems)
      ? patch.manualItems.filter((m) => m && String(m.label || '').trim()).slice(0, 100)
          .map((m) => ({ id: m.id || rand(), label: String(m.label).trim().slice(0, 80), points: Math.round(num(m.points, 0)) }))
      : (b.manualItems || []),
    lastPenaltyRun: turningOn ? today : b.lastPenaltyRun || '',
    lastMonthRollup: turningOn ? prevMonth(currentMonth()) : b.lastMonthRollup || '',
    lastAbsenceScan: turningOn ? today : b.lastAbsenceScan || '',
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
      const label = r.key === 'punctualStreak' ? 'Punctual week (on time all week)' : meta.label;
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

/**
 * Record an automatic award exactly once.
 *
 * `key` identifies the award itself (who, what, which day or month). Two Lambdas
 * running the same scan at the same instant both used to find nothing and both
 * insert; upserting on the unique dedupeKey means the second one updates the row the
 * first created instead of adding a duplicate. Returns nothing — callers don't care
 * which of them won.
 */
async function awardOnce(key, { user, month, points, reason, source, taskRef = null }, { replace = false } = {}) {
  const doc = { user, month, points, reason, source, taskRef };
  await PointEntry.updateOne(
    { dedupeKey: key },
    // Insert-only by default: an award already on the books stays exactly as it was
    // written, in the month it was written. Re-running a scan must never move a July
    // penalty into August's total. `replace` is for the two cases that genuinely
    // recompute — a day's overtime, and a task's result superseding its overdue mark.
    replace ? { $set: doc, $setOnInsert: { dedupeKey: key } } : { $setOnInsert: { ...doc, dedupeKey: key } },
    { upsert: true },
  );
}

// ── Event hooks (called from other services) ─────────────────────────────────

export async function onAssignedTaskDone(task) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled || !task.assignedBy) return;
  // Work that was passed further down belongs to whoever it ended up with. Finishing at
  // the bottom settles every copy above it (settleParent), and each of those settles
  // used to score its own holder too — so a single job paid two or three people. The
  // copy that was actually worked is the one with nothing forwarded off it, and that is
  // the only one scored. The leaderboard already counts it this way.
  if (await Task.exists({ forwardedFrom: task._id })) {
    // Clear anything already on it (an overdue penalty from before it was passed on).
    await PointEntry.deleteMany({ taskRef: task._id, source: 'auto_task' });
    return;
  }
  await PointEntry.deleteMany({ taskRef: task._id, source: 'auto_task' });
  // On-time is judged from when the assignee did the work — for approval-gated tasks
  // that's the submit time, so a slow approval never turns on-time work into "late".
  // Only trust submittedAt when the task is actually an approval task (guards against a
  // stale submit timestamp left behind if the gate was later switched off).
  const completedYMD = ymdInTz((task.requiresApproval && task.submittedAt) || task.completedAt || new Date());
  const late = task.dueYMD && completedYMD > addDays(task.dueYMD, b.graceDays || 0);
  const pts = rulePoints(b, late ? 'assignedTaskLate' : 'assignedTaskOnTime');
  if (!pts) return;
  // replace: the finished result supersedes any overdue penalty already recorded.
  await awardOnce(`auto_task:${task._id}`, { user: task.owner, month: completedYMD.slice(0, 7), points: late ? -Math.abs(pts) : Math.abs(pts), reason: `${late ? 'Late completion' : 'Completed'}: ${task.title}`, source: 'auto_task', taskRef: task._id }, { replace: true });
}

export async function onAssignedTaskUndone(taskId) {
  await PointEntry.deleteMany({ taskRef: taskId, source: 'auto_task' });
}

/**
 * After a check-in: a late arrival is penalised. The punctual-streak reward is NO LONGER
 * decided here — it's a full-week thing now (Mon–Sat), evaluated once the week closes in
 * runWeeklyStreak (called from the daily scan). Deciding it per check-in couldn't work:
 * a week whose last working day is a holiday/leave has no final check-in to trigger on.
 */
export async function onCheckIn(user, dateYMD, isLate) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled) return;
  if (isLate) {
    const pts = rulePoints(b, 'lateArrival');
    if (pts) {
      await awardOnce(`auto_late:${user._id}:${dateYMD}`, { user: user._id, month: dateYMD.slice(0, 7), points: -Math.abs(pts), reason: `Late arrival · ${dateYMD}`, source: 'auto_late' });
    }
  }
}

/** After a check-out: award points per full hour of overtime (replaces the day's OT entry). */
export async function onCheckOut(user, dateYMD, overtimeMinutes) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled) return;
  const pts = rulePoints(b, 'overtimeHour');
  // One overtime entry per day. Keyed by the DAY the overtime belongs to rather than
  // matched on when the row happened to be written, so re-running it just rewrites
  // that day's award to the new figure.
  const key = `auto_ot:${user._id}:${dateYMD}`;
  // An overtime row written before keys existed carries none, so the keyed upsert below
  // wouldn't see it — correcting a pre-key day would leave the old award standing beside
  // the new one. Those legacy rows were only ever written by a self-checkout, so their
  // createdAt IS the overtime day; clear that day's keyless row first.
  const { start, end } = dayRange(dateYMD);
  await PointEntry.deleteMany({ user: user._id, source: 'auto_ot', dedupeKey: { $exists: false }, createdAt: { $gte: start, $lt: end } });
  const hours = Math.floor((overtimeMinutes || 0) / 60);
  if (pts && hours > 0) {
    await awardOnce(key, { user: user._id, month: dateYMD.slice(0, 7), points: Math.abs(pts) * hours, reason: `Overtime · ${dateYMD} (${hours}h)`, source: 'auto_ot' }, { replace: true });
  } else {
    // The day no longer earns anything (corrected check-out, rule switched off).
    await PointEntry.deleteOne({ dedupeKey: key });
  }
}

// ── Daily scans + month rollup (run opportunistically, no cron) ───────────────

async function scanOverdueTasks(b) {
  const pts = rulePoints(b, 'assignedTaskLate');
  if (!pts) return;
  const today = ymdInTz(new Date());
  // Work that was passed further down is now somebody else's to deliver. Their copy is
  // the one that gets scored; the copy left behind up the chain stays PENDING until the
  // bottom is finished, so counting it too penalised two people for one late job. The
  // task leaderboard already excludes these — the penalty has to agree with it.
  const forwardedParentIds = await Task.distinct('forwardedFrom', { forwardedFrom: { $ne: null } });
  // Skip tasks already submitted for approval — the assignee did the work; a slow
  // approval must not become an "overdue" penalty on them.
  const tasks = await Task.find({ assignedBy: { $ne: null }, status: 'PENDING', dueYMD: { $ne: '' }, submittedAt: null, _id: { $nin: forwardedParentIds } }).select('owner dueYMD title');
  for (const t of tasks) {
    if (addDays(t.dueYMD, b.graceDays || 0) >= today) continue;
    // Belt and braces on top of the dedupe key: an entry written before keys existed
    // carries only taskRef, so keying alone would not see it and would penalise the
    // same task a second time on the first run after an upgrade.
    // eslint-disable-next-line no-await-in-loop
    if (await PointEntry.findOne({ taskRef: t._id, source: 'auto_task' })) continue;
    // Same key the completion award uses, so a task carries exactly one auto entry —
    // the overdue penalty is replaced by the result once it's finished.
    // eslint-disable-next-line no-await-in-loop
    await awardOnce(`auto_task:${t._id}`, { user: t.owner, month: today.slice(0, 7), points: -Math.abs(pts), reason: `Overdue: ${t.title}`, source: 'auto_task', taskRef: t._id });
  }
}

/**
 * Absence penalties for every day not scored yet — not just yesterday.
 *
 * This runs off whatever request happens to be the day's first, so on a public holiday,
 * during an outage, or simply on a day nobody opens the app, it doesn't run at all. It
 * used to look only at "yesterday", so any day it missed was never revisited and its
 * absences were silently dropped for good. `since` is the day it last ran, so it now
 * works through every day from there up to yesterday and catches up.
 */
async function scanAbsences(b, since) {
  const pts = rulePoints(b, 'absentDay');
  if (!pts) return;
  const yesterday = prevDay(ymdInTz(new Date()));
  // Nothing was tracked before the office started running on this system, so a day
  // from before it can't be an absence — no matter what joining dates say (real,
  // older hire dates get entered over time and would otherwise reopen this).
  if (yesterday < APP_LIVE_YMD) return;

  // Never reach further back than the go-live day, and cap the catch-up so a long
  // silence (or a first run with no watermark) can't turn into a months-long sweep.
  const MAX_CATCHUP_DAYS = 31;
  let start = since && since > APP_LIVE_YMD ? since : APP_LIVE_YMD;
  let floor = yesterday;
  for (let i = 0; i < MAX_CATCHUP_DAYS - 1; i += 1) floor = prevDay(floor);
  if (start < floor) start = floor;

  const days = [];
  for (let d = yesterday; d >= start && days.length < MAX_CATCHUP_DAYS; d = prevDay(d)) days.push(d);
  days.reverse(); // oldest first, so the history reads in order
  if (!days.length) return;

  const s = await Setting.getSingleton();
  const holidays = await holidayYMDSet(days[0], days[days.length - 1]);
  const users = (await User.find({ isActive: true }).select('name role employmentType schedule dateOfJoining')).filter((u) => can({ role: u.role }, 'markAttendance'));
  // One query for the whole window instead of one per day.
  const attended = await Attendance.find({ date: { $gte: companyDayFromYMD(days[0]), $lte: companyDayFromYMD(days[days.length - 1]) } }).select('user date');
  const presentByDay = new Map();
  for (const r of attended) {
    const ymd = ymdInTz(r.date);
    if (!presentByDay.has(ymd)) presentByDay.set(ymd, new Set());
    presentByDay.get(ymd).add(String(r.user));
  }
  const leaves = await LeaveRequest.find({ status: 'APPROVED', startYMD: { $lte: days[days.length - 1] }, endYMD: { $gte: days[0] } }).select('user startYMD endYMD');

  for (const ymd of days) {
    if (holidays.has(ymd)) continue;
    const dow = dayOfWeekInTz(companyDayFromYMD(ymd));
    const present = presentByDay.get(ymd) || new Set();
    const onLeave = new Set(leaves.filter((l) => l.startYMD <= ymd && l.endYMD >= ymd).map((l) => String(l.user)));
    const month = ymd.slice(0, 7);
    for (const u of users) {
      if (!hadAccessOn(u, ymd)) continue; // they hadn't joined — not an absence
      if (userWeekendDays(u, s).includes(dow)) continue;
      if (present.has(String(u._id)) || onLeave.has(String(u._id))) continue;
      // eslint-disable-next-line no-await-in-loop
      await awardOnce(`auto_absent:${u._id}:${ymd}`, { user: u._id, month, points: -Math.abs(pts), reason: `Absent · ${ymd}`, source: 'auto_absent' });
    }
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
  const roster = (await User.find({ isActive: true }).select('name role employmentType schedule dateOfJoining')).filter((u) => can({ role: u.role }, 'markAttendance'));
  // Someone who joined after this month never worked it; someone who joined during it
  // is judged only on their own days, so a mid-month joiner isn't denied a perfect
  // month for days before they had access.
  const { included: users } = splitByJoining(roster, from, monthEnd);

  for (const u of users) {
    const startedOn = periodStartFor(u, from);
    // no-leave award
    if (noLeavePts) {
      // WFH is not leave — a work-from-home day must not cost somebody their
      // "no leave taken all month" award.
      const took = await LeaveRequest.countDocuments({ user: u._id, status: 'APPROVED', type: { $ne: 'WFH' }, startYMD: { $lte: monthEnd }, endYMD: { $gte: from } });
      if (took === 0) {
        await awardOnce(`auto_noleave:${u._id}:${target}`, { user: u._id, month: target, points: Math.abs(noLeavePts), reason: 'No leave taken all month', source: 'auto_noleave' });
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
        if (ymd < startedOn) continue; // before they joined
        const dow = dayOfWeekInTz(companyDayFromYMD(ymd));
        if (offDays.includes(dow) || holidays.has(ymd)) continue;
        workingDays += 1;
        const rec = byDay.get(ymd);
        if (!rec) absent += 1;
        else if (rec.status === 'LATE' && !rec.excused) lateBad += 1;
        else if (rec.status === 'ABSENT') absent += 1;
      }
      if (workingDays > 0 && absent === 0 && lateBad === 0) {
        await awardOnce(`auto_perfect:${u._id}:${target}`, { user: u._id, month: target, points: Math.abs(perfectPts), reason: 'Perfect attendance all month', source: 'auto_perfect' });
      }
    }
  }
  return target;
}

/** The most recent fully-finished Mon–Sat week (its Saturday falls before today). */
function lastCompletedWeek() {
  let end = prevDay(ymdInTz(new Date()));
  for (let i = 0; i < 7 && dayOfWeekInTz(companyDayFromYMD(end)) !== 6; i += 1) end = prevDay(end);
  return { start: addDays(end, -5), end }; // Monday … Saturday
}

/**
 * Weekly punctual-week award. Once a Mon–Sat week is over, anyone who — across their OWN
 * working days that week — was never unexcused-late and never absent-without-leave earns
 * the `punctualStreak` points. Per the office rule, Sunday, holidays, approved leave and
 * WFH are all NEUTRAL: they never break the week (a full leave/WFH week still qualifies).
 * Only a late check-in or an unexplained no-show disqualifies. Awarded once per week
 * (dedup keyed on the week's Monday); the entry's month is the week-ending Saturday's.
 * Part-timers are judged on their own workdays inside the span; mid-week joiners / the
 * go-live week only on the days they actually had access.
 */
export async function runWeeklyStreak(b) {
  const pts = rulePoints(b, 'punctualStreak');
  if (!pts) return;
  const { start, end } = lastCompletedWeek();
  if (end < APP_LIVE_YMD) return; // the week ended before the system went live

  const s = await Setting.getSingleton();
  const holidays = await holidayYMDSet(start, end);
  const roster = (await User.find({ isActive: true }).select('name role employmentType schedule dateOfJoining')).filter((u) => can({ role: u.role }, 'markAttendance'));
  const { included: users } = splitByJoining(roster, start, end);
  if (!users.length) return;

  const recs = await Attendance.find({ date: { $gte: companyDayFromYMD(start), $lte: companyDayFromYMD(end) } }).select('user date status excused');
  const recByUserDay = new Map(recs.map((r) => [`${r.user}|${ymdInTz(r.date)}`, r]));
  const leaves = await LeaveRequest.find({ status: 'APPROVED', startYMD: { $lte: end }, endYMD: { $gte: start } }).select('user startYMD endYMD');
  const monthOfAward = end.slice(0, 7); // week-ending Saturday's month

  for (const u of users) {
    const startedOn = periodStartFor(u, start);
    const off = userWeekendDays(u, s);
    let workingDays = 0;
    let broke = false;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (d < startedOn) continue; // before they had access (joiner / go-live)
      const dow = dayOfWeekInTz(companyDayFromYMD(d));
      if (off.includes(dow) || holidays.has(d)) continue; // Sunday / off-day / holiday → neutral
      workingDays += 1;
      const rec = recByUserDay.get(`${u._id}|${d}`);
      const onLeave = leaves.some((l) => String(l.user) === String(u._id) && l.startYMD <= d && l.endYMD >= d);
      if (rec) {
        if (rec.status === 'LATE' && !rec.excused) { broke = true; break; } // an unexcused late breaks it
        if (rec.status === 'ABSENT' && !onLeave) { broke = true; break; } // marked absent, no leave
      } else if (!onLeave) {
        broke = true; break; // no record and no approved leave = unexplained absence
      }
      // PRESENT (on time), WFH, ON_LEAVE, or an approved-leave day → all fine
    }
    if (workingDays > 0 && !broke) {
      // eslint-disable-next-line no-await-in-loop
      await awardOnce(`auto_streak:${u._id}:${start}`, { user: u._id, month: monthOfAward, points: Math.abs(pts), reason: `Punctual week · ${start} to ${end}`, source: 'auto_streak' });
    }
  }
}

/** Runs the daily scans + month rollup at most once a day (no cron needed). */
export async function maybeRunDaily() {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled) return;
  const today = ymdInTz(new Date());
  if (b.lastPenaltyRun === today) return;
  // Where the absence catch-up starts. Kept SEPARATE from the once-a-day throttle and
  // moved forward only after the scan actually succeeds: the throttle has to be written
  // immediately (it is what stops a second instance running the same day), but if it
  // doubled as the watermark then a scan that failed would have already declared its
  // days done and they would never be looked at again — the exact hole this catch-up
  // was added to close.
  const scanFrom = b.lastAbsenceScan || b.lastPenaltyRun || '';
  s.bonus.lastPenaltyRun = today; // throttle first
  const rolled = await runMonthRollup(b).catch((e) => { console.error('month rollup failed', e?.message); return b.lastMonthRollup; });
  if (rolled) s.bonus.lastMonthRollup = rolled;
  await s.save();
  try { await scanOverdueTasks(b); } catch (e) { console.error('overdue scan failed', e?.message); }
  // Weekly punctual-week award — dedup-keyed on the week's Monday, so a daily run is safe.
  try { await runWeeklyStreak(b); } catch (e) { console.error('weekly streak failed', e?.message); }
  try {
    await scanAbsences(b, scanFrom);
    // Only now are those days genuinely accounted for.
    await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.lastAbsenceScan': today } });
    Setting.invalidateCache();
  } catch (e) {
    console.error('absence scan failed', e?.message);
  }
}
