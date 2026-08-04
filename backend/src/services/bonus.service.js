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
    historyScored: b.historyScored || '', // never reset by a settings save
    rescoreVersion: b.rescoreVersion || '', // one-time re-score watermark, preserved
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

/**
 * One person's points for a single month OR a month range (financial year, etc.).
 *
 * Accepts either `{month: 'YYYY-MM'}` (single) or `{from: 'YYYY-MM', to: 'YYYY-MM'}`
 * (inclusive). No args → current month, matching the header badge's default. The month
 * range uses the existing `month` string index — PointEntry.month is always 'YYYY-MM',
 * so lexicographic $gte/$lte works and the query stays indexed. Entries cap is bumped
 * on a range so a full 12-month view isn't silently truncated.
 */
export async function mySummary(user, params = {}) {
  const cfg = await getConfig();
  const isRange = !!(params.from && params.to);
  const month = isRange ? undefined : params.month || currentMonth();

  const matchMonth = isRange ? { $gte: params.from, $lte: params.to } : month;
  const [agg] = await PointEntry.aggregate([
    { $match: { user: toId(user._id), month: matchMonth } },
    { $group: { _id: null, points: { $sum: '$points' } } },
  ]);
  const points = agg?.points || 0;
  // Newest FIRST by the day it was earned — a month scored after the fact was written
  // all at once, so sorting on createdAt would list it in an arbitrary order.
  const entries = await PointEntry.find({ user: user._id, month: matchMonth })
    .sort({ earnedYMD: -1, createdAt: -1 })
    .limit(isRange ? 1200 : 200);

  return {
    enabled: cfg.enabled,
    month: month || null,
    range: isRange ? { from: params.from, to: params.to } : null,
    points,
    rupees: cfg.rupeesPerPoint ? Math.round(points * cfg.rupeesPerPoint) : 0,
    rupeesPerPoint: cfg.rupeesPerPoint,
    entries: entries.map((e) => e.toJSON()),
  };
}

/**
 * Any one person's summary for a period — the leadership view behind a leaderboard click.
 * Same shape as mySummary, plus who the person is, so the drill-down can be titled.
 */
export async function userSummary(userId, params = {}) {
  const u = await User.findById(userId).select('name role employeeId');
  if (!u) throw httpError(404, 'NOT_FOUND', 'That user was not found');
  const sum = await mySummary(u, params);
  return { user: { id: String(u._id), name: u.name, role: u.role, employeeId: u.employeeId }, ...sum };
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
  const entry = await PointEntry.create({ user: target._id, month: month || currentMonth(), earnedYMD: ymdInTz(new Date()), points: Math.round(pts), reason: label.slice(0, 140), source: 'manual', awardedBy: actor._id });
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

/**
 * Everyone's totals for a period — a single month, or a range (a financial year), the
 * same shapes mySummary takes so the board always matches the period on screen.
 */
export async function leaderboard(params = {}) {
  const p = typeof params === 'string' ? { month: params } : (params || {});
  const isRange = !!(p.from && p.to);
  const matchMonth = isRange ? { $gte: p.from, $lte: p.to } : (p.month || currentMonth());
  const rows = await PointEntry.aggregate([{ $match: { month: matchMonth } }, { $group: { _id: '$user', points: { $sum: '$points' } } }, { $sort: { points: -1 } }]);
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
async function awardOnce(key, { user, month, points, reason, source, taskRef = null, earnedYMD = '' }, { replace = false } = {}) {
  const doc = { user, month, points, reason, source, taskRef };
  await PointEntry.updateOne(
    { dedupeKey: key },
    // Insert-only by default: an award already on the books stays exactly as it was
    // written, in the month it was written. Re-running a scan must never move a July
    // penalty into August's total. `replace` is for the two cases that genuinely
    // recompute — a day's overtime, and a task's result superseding its overdue mark.
    // earnedYMD is always $set, even on an insert-only award: it is derived from the
    // event, not a value that should freeze at whatever the first write happened to know.
    replace
      ? { $set: { ...doc, earnedYMD }, $setOnInsert: { dedupeKey: key } }
      : { $set: { earnedYMD }, $setOnInsert: { ...doc, dedupeKey: key } },
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
  // On-time is judged from the day the task was actually COMPLETED. For an approval task
  // that is the day the assigner approved it (completedAt is stamped at approval), so a
  // task approved after its due date + grace counts as late even if it was submitted on
  // time — the office wants the finish line, not the hand-in, to decide.
  const rawYMD = ymdInTz(task.completedAt || new Date());
  // Nothing predates go-live: a task carrying an earlier completion date (an import
  // artifact, a back-dated record) would otherwise show on somebody's Rewards page days
  // before they even had access. Clamp it forward so the earliest a reward can appear is
  // the day the office started running on this system.
  const completedYMD = rawYMD < APP_LIVE_YMD ? APP_LIVE_YMD : rawYMD;
  // Late is judged on the real completion day vs the due date — the clamp above only
  // decides which day/month the points are filed under, never whether it was on time.
  const late = task.dueYMD && rawYMD > addDays(task.dueYMD, b.graceDays || 0);
  const pts = rulePoints(b, late ? 'assignedTaskLate' : 'assignedTaskOnTime');
  if (!pts) return;
  // replace: the finished result supersedes any overdue penalty already recorded.
  await awardOnce(`auto_task:${task._id}`, { user: task.owner, month: completedYMD.slice(0, 7), points: late ? -Math.abs(pts) : Math.abs(pts), reason: `${late ? 'Late completion' : 'Completed'}: ${task.title}`, source: 'auto_task', taskRef: task._id, earnedYMD: completedYMD }, { replace: true });
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
      await awardOnce(`auto_late:${user._id}:${dateYMD}`, { user: user._id, month: dateYMD.slice(0, 7), points: -Math.abs(pts), reason: `Late arrival · ${dateYMD}`, source: 'auto_late', earnedYMD: dateYMD });
    }
  }
}

/** A human overtime total: "9h 46m", "18h", "46m". */
function otLabel(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Overtime is scored as ONE row per person per month, off the month's TOTAL overtime —
 * never a separate row for each day. Full hours pay the per-hour rate; a leftover of MORE
 * than 30 minutes adds half the rate (rounded), 30 minutes or less adds nothing. So at
 * 2 points/hour, 9h 46m earns 9×2 + 1 = 19, while 9h 20m earns just 18.
 *
 * Always re-derived from attendance, and every older overtime row for that user-month —
 * the per-day ones, keyless legacy ones, and the monthly row itself — is cleared first,
 * so moving to the monthly model, a corrected check-out, or the rule being switched off
 * can never leave a stale row behind to double-count.
 */
async function recomputeMonthlyOvertime(b, userId, month) {
  await PointEntry.deleteMany({ user: userId, source: 'auto_ot', month });
  const pts = Math.abs(rulePoints(b, 'overtimeHour'));
  if (!pts) return;
  const from = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const to = `${month}-${String(lastDay).padStart(2, '0')}`;
  const recs = await Attendance.find({ user: userId, date: { $gte: companyDayFromYMD(from), $lte: companyDayFromYMD(to) } }).select('date overtimeMinutes');
  let total = 0;
  let lastOtDay = '';
  for (const r of recs) {
    const min = r.overtimeMinutes || 0;
    if (min <= 0) continue;
    total += min;
    const ymd = ymdInTz(r.date);
    if (ymd > lastOtDay) lastOtDay = ymd;
  }
  if (total <= 0) return;
  const hours = Math.floor(total / 60);
  const leftover = total % 60;
  const points = hours * pts + (leftover > 30 ? Math.round(pts / 2) : 0);
  if (points <= 0) return;
  await awardOnce(
    `auto_ot:${userId}:${month}`,
    { user: userId, month, points, reason: `Overtime · ${otLabel(total)}`, source: 'auto_ot', earnedYMD: lastOtDay || to },
    { replace: true },
  );
}

/** After a check-out (or any attendance edit): rebuild the month's single overtime row. */
export async function onCheckOut(user, dateYMD) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled) return;
  await recomputeMonthlyOvertime(b, user._id, dateYMD.slice(0, 7));
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
    await awardOnce(`auto_task:${t._id}`, { user: t.owner, month: today.slice(0, 7), points: -Math.abs(pts), reason: `Overdue: ${t.title}`, source: 'auto_task', taskRef: t._id, earnedYMD: today });
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
async function scanAbsences(b, since, until = null) {
  const pts = rulePoints(b, 'absentDay');
  if (!pts) return;
  // Today isn't finished, so the newest day that can be judged is yesterday — unless a
  // caller (the backfill) names an earlier last day.
  const yesterday = prevDay(ymdInTz(new Date()));
  const lastDay = until && until < yesterday ? until : yesterday;
  // Nothing was tracked before the office started running on this system, so a day
  // from before it can't be an absence — no matter what joining dates say (real,
  // older hire dates get entered over time and would otherwise reopen this).
  if (lastDay < APP_LIVE_YMD) return;

  // Never reach further back than the go-live day, and cap the catch-up so a long
  // silence (or a first run with no watermark) can't turn into a months-long sweep.
  const MAX_CATCHUP_DAYS = 31;
  let start = since && since > APP_LIVE_YMD ? since : APP_LIVE_YMD;
  let floor = lastDay;
  for (let i = 0; i < MAX_CATCHUP_DAYS - 1; i += 1) floor = prevDay(floor);
  if (start < floor) start = floor;

  const days = [];
  for (let d = lastDay; d >= start && days.length < MAX_CATCHUP_DAYS; d = prevDay(d)) days.push(d);
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
      await awardOnce(`auto_absent:${u._id}:${ymd}`, { user: u._id, month, points: -Math.abs(pts), reason: `Absent · ${ymd}`, source: 'auto_absent', earnedYMD: ymd });
    }
  }
}

/**
 * Month-end awards (no-leave, perfect attendance) for the just-finished month — or for
 * any month a caller names, which is what the backfill uses. When a month is named the
 * "already processed" watermark is skipped: awardOnce keys make a re-run harmless.
 */
async function runMonthRollup(b, forMonth = null) {
  const thisMonth = currentMonth();
  const done = b.lastMonthRollup;
  const target = forMonth || prevMonth(thisMonth);
  if (!forMonth && done === target) return target; // already processed
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
        await awardOnce(`auto_noleave:${u._id}:${target}`, { user: u._id, month: target, points: Math.abs(noLeavePts), reason: 'No leave taken all month', source: 'auto_noleave', earnedYMD: monthEnd });
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
        await awardOnce(`auto_perfect:${u._id}:${target}`, { user: u._id, month: target, points: Math.abs(perfectPts), reason: 'Perfect attendance all month', source: 'auto_perfect', earnedYMD: monthEnd });
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
export async function runWeeklyStreak(b, week = null) {
  const pts = rulePoints(b, 'punctualStreak');
  if (!pts) return;
  // Defaults to the week that just finished; a caller (the backfill) may name any week.
  const { start, end } = week || lastCompletedWeek();
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
      await awardOnce(`auto_streak:${u._id}:${start}`, { user: u._id, month: monthOfAward, points: Math.abs(pts), reason: `Punctual week · ${start} to ${end}`, source: 'auto_streak', earnedYMD: end });
    }
  }
}

/**
 * Score a PAST month with the rules exactly as they stand today — the deliberate,
 * leadership-triggered counterpart to the automatic scans.
 *
 * Switching the scheme on never scores the past on its own (that would hand out awards
 * for a month nobody had been told the rules for), so a month that had already gone by
 * when the point values were entered simply has no entries. This is how you fill it in
 * on purpose.
 *
 * Every rule that can be derived from what was actually recorded is applied: late
 * arrivals, overtime, absences, the punctual weeks whose Saturday falls in the month,
 * every assigned task finished in it, and the month-end no-leave / perfect-attendance
 * awards. Manual awards are, of course, not invented.
 *
 * Safe to run again: every award is written under the same dedupe key the live scans
 * use, so a second pass adds nothing and changes nothing.
 */
export async function backfillMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw httpError(400, 'BAD_MONTH', 'Pick a month to recalculate');
  const thisMonth = currentMonth();
  if (month > thisMonth) throw httpError(400, 'FUTURE_MONTH', 'That month hasn’t happened yet');
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled) throw httpError(400, 'DISABLED', 'Turn the bonus system on first');

  const from = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const to = `${month}-${String(lastDay).padStart(2, '0')}`;
  // Nothing was tracked before go-live, and today isn't finished yet.
  const start = from < APP_LIVE_YMD ? APP_LIVE_YMD : from;
  const yesterday = prevDay(ymdInTz(new Date()));
  const end = to > yesterday ? yesterday : to;
  if (end < start) throw httpError(400, 'NO_DAYS', 'There are no finished days in that month yet');

  const before = await PointEntry.countDocuments({ month });

  // 1. Attendance-derived awards, straight off what was recorded that month.
  const latePts = rulePoints(b, 'lateArrival');
  const otPts = rulePoints(b, 'overtimeHour');
  if (latePts) {
    const recs = await Attendance.find({ date: { $gte: companyDayFromYMD(start), $lte: companyDayFromYMD(end) }, status: 'LATE' }).select('user date');
    for (const r of recs) {
      const ymd = ymdInTz(r.date);
      // eslint-disable-next-line no-await-in-loop
      await awardOnce(`auto_late:${r.user}:${ymd}`, { user: r.user, month: ymd.slice(0, 7), points: -Math.abs(latePts), reason: `Late arrival · ${ymd}`, source: 'auto_late', earnedYMD: ymd });
    }
  }
  // Overtime is one row per person for the whole month, so recompute it per person rather
  // than per day (see recomputeMonthlyOvertime): full hours × rate, plus half the rate for
  // a leftover over 30 minutes.
  if (otPts) {
    const otUsers = await Attendance.distinct('user', { date: { $gte: companyDayFromYMD(start), $lte: companyDayFromYMD(end) }, overtimeMinutes: { $gt: 0 } });
    for (const uid of otUsers) {
      // eslint-disable-next-line no-await-in-loop
      await recomputeMonthlyOvertime(b, uid, month);
    }
  }

  // 2. Absences — the same scan the daily job runs, pointed at this month.
  await scanAbsences(b, start, end);

  // 3. Punctual weeks: every Mon–Sat week whose SATURDAY lands in this month, which is
  //    the month such an award belongs to (a week may straddle two months).
  let sat = start;
  while (dayOfWeekInTz(companyDayFromYMD(sat)) !== 6) sat = addDays(sat, 1);
  for (; sat <= end; sat = addDays(sat, 7)) {
    // eslint-disable-next-line no-await-in-loop
    await runWeeklyStreak(b, { start: addDays(sat, -5), end: sat });
  }

  // 4. Assigned tasks finished in the month — scored by the same hook the live path uses,
  //    so on-time/late, grace days and the forwarded-copy rule all behave identically.
  if (rulePoints(b, 'assignedTaskOnTime') || rulePoints(b, 'assignedTaskLate')) {
    const tasks = await Task.find({ status: 'DONE', assignedBy: { $ne: null }, completedAt: { $ne: null } }).select('owner dueYMD title completedAt submittedAt requiresApproval assignedBy');
    for (const t of tasks) {
      const doneYMD = ymdInTz(t.completedAt); // the completion/approval day decides the month
      if (doneYMD < from || doneYMD > to) continue;
      // eslint-disable-next-line no-await-in-loop
      await onAssignedTaskDone(t);
    }
  }

  // 5. Month-end awards — only once the month is genuinely over.
  if (month < thisMonth) await runMonthRollup(b, month);

  const after = await PointEntry.countDocuments({ month });
  return { month, added: after - before, total: after };
}

const nextMonth = (ym) => {
  const [y, m] = String(ym).split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/**
 * Score the months that went by BEFORE the point values were entered.
 *
 * The scheme is switched on part-way through the office's life, and switching it on
 * deliberately doesn't score the past on the spot. But everything those months need was
 * recorded all along — attendance, overtime, finished tasks — so leaving them blank just
 * means people's earlier work is missing from their own Rewards page. This walks forward
 * from go-live to the last finished month, once, and fills them in.
 *
 * Its own watermark, independent of the daily throttle, so it runs on the very next
 * request after a deploy rather than waiting for tomorrow. A couple of months per run
 * keeps any single request short; the rest follow on the next one.
 */
async function catchUpHistory(b) {
  const target = prevMonth(currentMonth()); // the last month that is actually over
  const firstMonth = APP_LIVE_YMD.slice(0, 7);
  let done = b.historyScored || '';
  if (done >= target) return;

  let m = done ? nextMonth(done) : firstMonth;
  let ran = 0;
  while (m <= target && ran < 2) {
    // eslint-disable-next-line no-await-in-loop
    await backfillMonth(m);
    done = m;
    ran += 1;
    m = nextMonth(m);
  }
  if (ran) {
    await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.historyScored': done } });
    Setting.invalidateCache();
  }
}

/**
 * Fill in `earnedYMD` on entries written before the field existed.
 *
 * Every automatic award's dedupe key ends in the day (or the month) it belongs to, so
 * the real date can be recovered from it — which matters most for the months scored
 * after the fact, where every row would otherwise read as the day of the scan. Task
 * awards carry no date in their key, so those take the task's own completion day.
 * Bounded and self-terminating: once nothing is missing it does nothing.
 */
async function repairEarnedDates() {
  const rows = await PointEntry.find({ $or: [{ earnedYMD: { $exists: false } }, { earnedYMD: '' }] })
    .select('dedupeKey month source taskRef createdAt')
    .limit(2000);
  if (!rows.length) return;

  const taskIds = rows.filter((r) => r.source === 'auto_task' && r.taskRef).map((r) => r.taskRef);
  const tasks = taskIds.length ? await Task.find({ _id: { $in: taskIds } }).select('completedAt submittedAt requiresApproval') : [];
  const taskById = new Map(tasks.map((t) => [String(t._id), t]));

  for (const r of rows) {
    let ymd = '';
    const key = r.dedupeKey || '';
    const day = key.match(/:(\d{4}-\d{2}-\d{2})$/);
    const mon = key.match(/:(\d{4}-\d{2})$/);
    if (day) {
      [, ymd] = day;
    } else if (r.source === 'auto_task' && taskById.has(String(r.taskRef))) {
      const t = taskById.get(String(r.taskRef));
      if (t.completedAt) ymd = ymdInTz(t.completedAt); // the completion/approval day

    } else if (mon) {
      // A month-end award belongs to the last day of its month.
      const [, ym] = mon;
      const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
      ymd = `${ym}-${String(last).padStart(2, '0')}`;
    }
    // Anything still unknown (a manual award) keeps the day it was written.
    if (!ymd) ymd = ymdInTz(r.createdAt || new Date());
    // eslint-disable-next-line no-await-in-loop
    await PointEntry.updateOne({ _id: r._id }, { $set: { earnedYMD: ymd } });
  }
}

/**
 * Fold pre-existing per-DAY overtime rows into the one-row-per-month model.
 *
 * Overtime used to be scored a row a day; it is now a single monthly total (see
 * recomputeMonthlyOvertime). This finds the user-months that still have the old per-day
 * rows — a dated key, or a keyless legacy row — and recomputes each into the single row.
 * Monthly rows carry a 'YYYY-MM' key, so they're never matched: once folded, it's done.
 */
async function consolidateOvertime(b) {
  const perDay = await PointEntry.find({
    source: 'auto_ot',
    $or: [{ dedupeKey: { $regex: /:\d{4}-\d{2}-\d{2}$/ } }, { dedupeKey: { $exists: false } }],
  }).select('user month').limit(3000);
  if (!perDay.length) return;
  const seen = new Set();
  for (const r of perDay) {
    const k = `${r.user}|${r.month}`;
    if (seen.has(k)) continue;
    seen.add(k);
    // eslint-disable-next-line no-await-in-loop
    await recomputeMonthlyOvertime(b, r.user, r.month);
  }
}

/**
 * Pull any award dated before go-live forward to it. Nothing was tracked before 1 July,
 * so an earlier date is always an artifact (a back-dated or imported task). The scans
 * already clamp; this catches task awards, which are dated from the task's own completion
 * day. Bounded and self-terminating.
 */
async function clampPreGoLive() {
  await PointEntry.updateMany(
    { earnedYMD: { $gt: '', $lt: APP_LIVE_YMD } },
    { $set: { earnedYMD: APP_LIVE_YMD, month: APP_LIVE_YMD.slice(0, 7) } },
  );
}

// Bump this whenever the way a task is scored changes; rescoreAssignedTasks re-runs once.
const RESCORE_VERSION = 'completed-date-v1';

/**
 * Re-score every finished assigned task once, so entries written under an OLD rule are
 * brought in line with how tasks are scored now (on-time judged from the completion /
 * approval day, not the submit day). Re-runs onAssignedTaskDone — which replaces each
 * task's entry in place and re-files its month — so it's safe and idempotent. Guarded by
 * a version watermark so it happens once after the deploy, not on every request.
 */
async function rescoreAssignedTasks(b) {
  if (b.rescoreVersion === RESCORE_VERSION) return;
  const tasks = await Task.find({ status: 'DONE', assignedBy: { $ne: null }, completedAt: { $ne: null } })
    .select('owner completedBy dueYMD title completedAt submittedAt requiresApproval assignedBy status')
    .limit(5000);
  for (const t of tasks) {
    // eslint-disable-next-line no-await-in-loop
    await onAssignedTaskDone(t);
  }
  await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.rescoreVersion': RESCORE_VERSION } });
  Setting.invalidateCache();
}

/** Runs the daily scans + month rollup at most once a day (no cron needed). */
export async function maybeRunDaily() {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled) return;
  // Before the daily throttle: the history catch-up has its own watermark and must not
  // have to wait for tomorrow just because today's scan already ran.
  try { await catchUpHistory(b); } catch (e) { console.error('history catch-up failed', e?.message); }
  try { await repairEarnedDates(); } catch (e) { console.error('earned-date repair failed', e?.message); }
  try { await consolidateOvertime(b); } catch (e) { console.error('overtime consolidation failed', e?.message); }
  try { await rescoreAssignedTasks(b); } catch (e) { console.error('task re-score failed', e?.message); }
  try { await clampPreGoLive(); } catch (e) { console.error('pre-go-live clamp failed', e?.message); }
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
