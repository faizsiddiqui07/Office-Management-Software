import mongoose from 'mongoose';
import { Setting } from '../models/Setting.js';
import { PointEntry } from '../models/PointEntry.js';
import { User } from '../models/User.js';
import { Task } from '../models/Task.js';
import { Attendance } from '../models/Attendance.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { can } from '../lib/permissions.js';
import { ownerRoleKeys } from '../lib/roles.js';
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
  { key: 'assignedTaskLate', label: 'Assigned task done or left late', hint: 'Cut the moment the due date passes unfinished — done late or not done at all', sign: 'penalty' },
  { key: 'assignedTaskOverdueDaily', label: 'Each extra day an assigned task stays overdue', hint: 'Per day after the first late mark, until done — approval-gated tasks until approved (tasks due from 1 Aug 2026)', sign: 'penalty' },
  { key: 'forwardOnTime', label: 'Forwarded a task, done on time', hint: 'For whoever passed the work down — when the chain finishes on time', sign: 'reward' },
  { key: 'forwardLate', label: 'Forwarded a task, done late', hint: 'For whoever passed the work down — when the chain finishes late', sign: 'penalty' },
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
function nextMonthYM(ym) {
  const [y, m] = String(ym).slice(0, 7).split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * The deficit a person carries INTO `targetMonth` — always ≤ 0.
 *
 * Only a NEGATIVE month total carries forward, and it keeps compounding until it's cleared:
 * a positive month resets (you don't hoard a surplus into the next month), a negative one
 * follows you. Computed live from the ledger by walking every month from go-live up to the
 * month before the target — so it's always in step with the real entries and needs no
 * stored carry-over rows (which would double-count in a range view). For each month:
 * net = that month's earned points + whatever was carried in; carry-out = min(0, net).
 */
async function carryInFor(userId, targetMonth) {
  const goLive = APP_LIVE_YMD.slice(0, 7);
  if (targetMonth <= goLive) return 0;
  const rows = await PointEntry.aggregate([
    { $match: { user: toId(userId), month: { $gte: goLive, $lt: targetMonth } } },
    { $group: { _id: '$month', earned: { $sum: '$points' } } },
  ]);
  const byMonth = new Map(rows.map((r) => [r._id, r.earned]));
  let carry = 0;
  for (let ym = goLive; ym < targetMonth; ym = nextMonthYM(ym)) {
    carry = Math.min(0, (byMonth.get(ym) || 0) + carry);
  }
  return carry;
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
  const earned = agg?.points || 0; // what was actually earned/lost within this period
  // A single month carries in the previous month's deficit (compounding, negatives only);
  // a range is shown as its raw earnings — carry-over is a month-to-month notion and would
  // double-count across a span. `points` is the NET the header + leaderboard read.
  const carriedOver = isRange ? 0 : await carryInFor(user._id, month);
  const points = earned + carriedOver;
  // Newest FIRST by the day it was earned — a month scored after the fact was written
  // all at once, so sorting on createdAt would list it in an arbitrary order.
  const entries = await PointEntry.find({ user: user._id, month: matchMonth })
    .sort({ earnedYMD: -1, createdAt: -1 })
    .limit(isRange ? 1200 : 200);

  return {
    enabled: cfg.enabled,
    month: month || null,
    range: isRange ? { from: params.from, to: params.to } : null,
    points, // net = earned + carriedOver
    earned, // just this period, before any carry-over
    carriedOver, // ≤ 0, the deficit brought from earlier months (0 for a range)
    // Payout is for a positive net only; a deficit doesn't pay a negative wage, it carries.
    rupees: cfg.rupeesPerPoint && points > 0 ? Math.round(points * cfg.rupeesPerPoint) : 0,
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
  let rows;
  if (isRange) {
    // A range is the raw sum of its entries (carry-over is month-to-month, not a span total).
    rows = await PointEntry.aggregate([
      { $match: { month: { $gte: p.from, $lte: p.to } } },
      { $group: { _id: '$user', points: { $sum: '$points' } } },
      { $sort: { points: -1 } },
    ]);
  } else {
    // Single month: rank by NET standing (earned this month + any carried-in deficit), so
    // the board agrees with the header badge and each person's own Rewards page.
    const targetMonth = p.month || currentMonth();
    const goLive = APP_LIVE_YMD.slice(0, 7);
    const agg = await PointEntry.aggregate([
      { $match: { month: { $gte: goLive, $lte: targetMonth } } },
      { $group: { _id: { user: '$user', month: '$month' }, earned: { $sum: '$points' } } },
    ]);
    const byUser = new Map();
    for (const r of agg) {
      const uid = String(r._id.user);
      if (!byUser.has(uid)) byUser.set(uid, new Map());
      byUser.get(uid).set(r._id.month, r.earned);
    }
    rows = [];
    for (const [uid, months] of byUser) {
      let carry = 0;
      for (let ym = goLive; ym < targetMonth; ym = nextMonthYM(ym)) carry = Math.min(0, (months.get(ym) || 0) + carry);
      const net = (months.get(targetMonth) || 0) + carry;
      // Skip anyone who nets zero and did nothing this month — no point listing a flat 0.
      if (net !== 0 || months.has(targetMonth)) rows.push({ _id: uid, points: net });
    }
    rows.sort((a, b) => b.points - a.points);
  }
  const users = await User.find({ _id: { $in: rows.map((r) => r._id) } }).select('name role employeeId');
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const cfg = await getConfig();
  return rows.map((r) => {
    const u = byId.get(String(r._id));
    return u ? { id: String(u._id), name: u.name, employeeId: u.employeeId, role: u.role, points: r.points, rupees: cfg.rupeesPerPoint && r.points > 0 ? Math.round(r.points * cfg.rupeesPerPoint) : 0 } : null;
  }).filter(Boolean);
}

/**
 * Per-employee bonus points for a REPORT period, scored the way each granularity is shown
 * elsewhere in the app:
 *  - a full single MONTH → the NET standing (this month's points + any carried-in deficit),
 *    exactly like the leaderboard / header badge for that month;
 *  - any OTHER window (a day, week, quarter, fiscal year or custom span) → the RAW points
 *    earned on days INSIDE the window, summed off earnedYMD (carry-over is a month-to-month
 *    idea that doesn't apply to an arbitrary span).
 * Returns { enabled, rupeesPerPoint, byUser: Map<userIdString, points> }. Empty when the
 * scheme is switched off, so the report can omit the section entirely.
 */
export async function periodPoints({ type, from, to }) {
  const cfg = await getConfig();
  if (!cfg.enabled) return { enabled: false, rupeesPerPoint: 0, byUser: new Map() };
  const byUser = new Map();
  if (type === 'monthly') {
    const rows = await leaderboard({ month: from.slice(0, 7) }); // NET, carry-in included
    for (const r of rows) byUser.set(String(r.id), r.points);
  } else {
    // earnedYMD is a 'YYYY-MM-DD' string, so a lexicographic range works for any window.
    const rows = await PointEntry.aggregate([
      { $match: { earnedYMD: { $gte: from, $lte: to } } },
      { $group: { _id: '$user', points: { $sum: '$points' } } },
    ]);
    for (const r of rows) byUser.set(String(r._id), r.points);
  }
  return { enabled: true, rupeesPerPoint: cfg.rupeesPerPoint, byUser };
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

/** Every copy forwarded off `rootId`, at any depth (the tree BELOW the root, root excluded). */
// ── Owner-tier visibility gate (user rule, 2026-08-07) ────────────────────────
// A task counts for points ONLY when the CEO & President can see it: they assigned it
// themselves, or at least one of them is TAGGED on it (collaborators). Otherwise the task
// is FULLY out of the points system — no rewards, no penalties, no leaderboard. Resolved
// by ROLE (the owner tier), never by name, so a role change adjusts the rule by itself.

let ownerIdsCache = null;
let ownerIdsAt = 0;
/** User-ids of everyone in the owner tier (CEO & President). Cached ~60s. */
async function ownerTierIds() {
  if (ownerIdsCache && Date.now() - ownerIdsAt < 60_000) return ownerIdsCache;
  const keys = ownerRoleKeys();
  const users = keys.length ? await User.find({ role: { $in: keys } }).select('_id') : [];
  ownerIdsCache = new Set(users.map((u) => String(u._id)));
  ownerIdsAt = Date.now();
  return ownerIdsCache;
}

/** Does THIS copy pass the gate on its own (owner-tier assigner, or one of them tagged)? */
function taskEligible(task, ownerIds) {
  // Roles not loaded (a cold path) must never read as "wipe everything".
  if (!ownerIds.size) return true;
  if (task.assignedBy && ownerIds.has(String(task.assignedBy))) return true;
  return (task.collaborators || []).some((c) => ownerIds.has(String(c)));
}

/**
 * Gate for a chain member: eligible if this copy OR any ancestor up the forward chain
 * passes (the root is where the assigner/tags live; forwarded copies inherit the chain's
 * visibility). `memo` de-dups ancestor fetches across a scan.
 */
async function chainEligible(task, ownerIds, memo = new Map()) {
  if (taskEligible(task, ownerIds)) return true;
  let cur = task;
  for (let depth = 0; cur.forwardedFrom && depth < 12; depth += 1) {
    const pid = String(cur.forwardedFrom);
    let parent = memo.get(pid);
    if (parent === undefined) {
      // eslint-disable-next-line no-await-in-loop
      parent = await Task.findById(pid).select('assignedBy collaborators forwardedFrom');
      memo.set(pid, parent);
    }
    if (!parent) break;
    if (taskEligible(parent, ownerIds)) return true;
    cur = parent;
  }
  return false;
}

async function collectChainCopies(rootId) {
  const out = [];
  let frontier = [rootId];
  let depth = 0;
  while (frontier.length && depth < 12) {
    // eslint-disable-next-line no-await-in-loop
    const kids = await Task.find({ forwardedFrom: { $in: frontier } }).select('owner forwardedFrom title assignedBy collaborators status');
    if (!kids.length) break;
    out.push(...kids);
    frontier = kids.map((k) => k._id);
    depth += 1;
  }
  return out;
}

/**
 * Score a finished task — and, when it's a forwarded chain, everyone in that chain at once.
 *
 * FULL-CHAIN GATING: nobody is paid until the work is accepted at the TOP of the chain.
 * Only the ROOT copy (the one directly assigned — nothing forwarded INTO it) awards, and it
 * pays the whole tree together. A copy finishing lower down settles upward (settleParent)
 * but pays no one on its own; if the chain is rejected or left pending anywhere above, the
 * root never reaches DONE and no points are ever written — so a later rejection at the top
 * means C, B and A all get nothing, exactly as intended.
 *
 * Within a settled chain:
 *  - a copy that was forwarded onward (has a child) = a FORWARDER → forwardOnTime / forwardLate;
 *  - a copy with nothing forwarded off it (a leaf) = the DOER → assignedTaskOnTime / assignedTaskLate.
 * On-time vs late is judged once, from the ROOT's final approval day (completedAt) vs its
 * due date + grace, and applied to everyone.
 */
export async function onAssignedTaskDone(task) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled || !task.assignedBy) return;
  // A non-root copy never pays out by itself — it waits for the top to accept the work.
  if (task.forwardedFrom) return;

  const descendants = await collectChainCopies(task._id);
  const copies = [task, ...descendants];

  // Owner-tier visibility gate: not assigned by the CEO & President and none of them
  // tagged anywhere on the chain -> the whole chain is out of the points system. Any
  // points written before (or before the task was untagged) are removed, so the daily
  // re-score keeps history honest in BOTH directions — tag later and it pays, untag and
  // it un-pays.
  const ownerIds = await ownerTierIds();
  if (!copies.some((c) => taskEligible(c, ownerIds))) {
    await PointEntry.deleteMany({ taskRef: { $in: copies.map((c) => c._id) }, source: { $in: ['auto_task', 'auto_forward'] } });
    return;
  }

  // The ids of copies that were forwarded onward — those owners are forwarders, the rest doers.
  const forwarderIds = new Set(descendants.map((c) => String(c.forwardedFrom)));

  const rawYMD = ymdInTz(task.completedAt || new Date());
  // Nothing predates go-live: a back-dated completion would otherwise surface on a Rewards
  // page before that person had access. Clamp forward for FILING only — lateness is still
  // judged on the real day.
  const completedYMD = rawYMD < APP_LIVE_YMD ? APP_LIVE_YMD : rawYMD;
  const late = task.dueYMD && rawYMD > addDays(task.dueYMD, b.graceDays || 0);
  // The cut happens when the due date passes (owner's rule): a LATE result is filed under
  // that day — same day/month as the -5 overdue mark it replaces — so finishing a stale
  // task months later never drags the penalty into a new month. On-time results are filed
  // under the completion day as before.
  const filedYMD = late ? overdueDayFor(task.dueYMD, b.graceDays) : completedYMD;

  for (const copy of copies) {
    // Defence in depth: only FINISHED copies are paid. The task service blocks closing a
    // copy while the one below it is still open, but a chain settled by any other route
    // must never hand a completion award to somebody whose copy is still pending.
    if (copy.status && copy.status !== 'DONE') {
      // eslint-disable-next-line no-continue
      continue;
    }
    const isForwarder = forwarderIds.has(String(copy._id));
    const key = isForwarder ? `auto_forward:${copy._id}` : `auto_task:${copy._id}`;
    const source = isForwarder ? 'auto_forward' : 'auto_task';
    // Clear any entry of the OTHER kind for this copy (e.g. an overdue auto_task mark on a
    // copy that turns out to be a forwarder), so a re-score never leaves a stale row behind.
    // eslint-disable-next-line no-await-in-loop
    await PointEntry.deleteMany({ taskRef: copy._id, source: isForwarder ? 'auto_task' : 'auto_forward' });
    const pts = rulePoints(b, isForwarder ? (late ? 'forwardLate' : 'forwardOnTime') : (late ? 'assignedTaskLate' : 'assignedTaskOnTime'));
    if (!pts) {
      // eslint-disable-next-line no-await-in-loop
      await PointEntry.deleteMany({ dedupeKey: key });
      // eslint-disable-next-line no-continue
      continue;
    }
    const what = isForwarder
      ? (late ? 'Forwarded, done late' : 'Forwarded, done on time')
      : (late ? 'Late completion' : 'Completed');
    // eslint-disable-next-line no-await-in-loop
    await awardOnce(key, {
      user: copy.owner,
      month: filedYMD.slice(0, 7),
      points: late ? -Math.abs(pts) : Math.abs(pts),
      reason: `${what}: ${copy.title || task.title}`,
      source,
      taskRef: copy._id,
      earnedYMD: filedYMD,
    }, { replace: true }); // replace: the finished result supersedes any overdue penalty
  }
}

export async function onAssignedTaskUndone(taskId) {
  await PointEntry.deleteMany({ taskRef: taskId, source: { $in: ['auto_task', 'auto_forward'] } });
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

/**
 * Make a day's late-arrival penalty match reality. `shouldPenalise` = the day is a LATE
 * that is NOT excused. When true (and the scheme + rule are on) the penalty is written
 * once; otherwise any existing penalty for that day is removed. This is what lets an
 * "excuse (on-duty)" actually take the minus back, and un-excusing put it back.
 */
export async function reconcileLatePenalty(userId, dateYMD, shouldPenalise) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  const key = `auto_late:${userId}:${dateYMD}`;
  if (b.enabled && shouldPenalise) {
    const pts = rulePoints(b, 'lateArrival');
    if (pts) {
      await awardOnce(key, { user: userId, month: dateYMD.slice(0, 7), points: -Math.abs(pts), reason: `Late arrival · ${dateYMD}`, source: 'auto_late', earnedYMD: dateYMD });
      return;
    }
  }
  await PointEntry.deleteMany({ dedupeKey: key });
}

/**
 * A day is no longer an absence (a check-in was recorded, or leave/WFH was applied), so
 * the daily scan's absent penalty for it must go. The scan's watermark has usually moved
 * past the day by the time it's corrected, so it would never self-heal without this.
 */
export async function clearAbsencePenalty(userId, dateYMD) {
  await PointEntry.deleteMany({ dedupeKey: `auto_absent:${userId}:${dateYMD}` });
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
 * NOTE: the half-for-a->30-min-leftover part is DELIBERATELY NOT spelled out on the Rules
 * page (owner's call) — it stays an internal calculation, but the calculation itself is on.
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
  const points = hours * pts + (leftover > 30 ? Math.round(pts / 2) : 0); // hidden from Rules, but active
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

/**
 * Rebuild one user-month's overtime points from attendance — used by the office-wide
 * overtime recompute after the overtime buffer (or workEnd) changes. No-op if bonus is off.
 */
export async function recomputeUserMonthOvertime(userId, month) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled) return;
  await recomputeMonthlyOvertime(b, userId, month);
}

// ── Daily scans + month rollup (run opportunistically, no cron) ───────────────

// The per-day overdue drip only counts for tasks DUE from August 2026 — the month the
// drip rule was introduced. The one-time -5 overdue mark has NO floor (owner's rule,
// 2026-08-08): any assigned task, whatever its due month, is marked the moment its due
// date passes unfinished.
const DRIP_FLOOR_YMD = '2026-08-01';

/** The day a task became overdue (due + grace + 1), never before go-live. The -5 mark
 *  and a late completion are both filed under THIS day — the cut happens when the due
 *  date passes, not whenever the task is eventually finished or the scan gets to it. */
function overdueDayFor(dueYMD, graceDays) {
  const d = addDays(dueYMD, (graceDays || 0) + 1);
  return d < APP_LIVE_YMD ? APP_LIVE_YMD : d;
}

async function scanOverdueTasks(b) {
  const pts = rulePoints(b, 'assignedTaskLate');
  const dripPts = rulePoints(b, 'assignedTaskOverdueDaily');
  if (!pts && !dripPts) return;
  const today = ymdInTz(new Date());
  // Work that was passed further down is now somebody else's to deliver (the copy left
  // behind stays PENDING until the bottom finishes); the leaderboard excludes these and
  // the penalties have to agree with it. Submitted-for-approval tasks are NOT skipped
  // (owner's rule, 2026-08-08): an approval-gated task counts as unfinished until it is
  // APPROVED — the mark and the drip both keep running while a review sits unapproved,
  // whoever's desk it is on. Only a task with no due date is outside this rule.
  const forwardedParentIds = await Task.distinct('forwardedFrom', { forwardedFrom: { $ne: null } });
  const tasks = await Task.find({ assignedBy: { $ne: null }, status: 'PENDING', dueYMD: { $nin: ['', null] }, _id: { $nin: forwardedParentIds } }).select('owner dueYMD title assignedBy collaborators forwardedFrom');
  const ownerIds = tasks.length ? await ownerTierIds() : new Set();
  const chainMemo = new Map();
  for (const t of tasks) {
    const duePlus = addDays(t.dueYMD, b.graceDays || 0);
    if (duePlus >= today) continue;
    // Owner-tier visibility gate: an untagged task is fully out — no mark, no drip.
    // eslint-disable-next-line no-await-in-loop
    if (!(await chainEligible(t, ownerIds, chainMemo))) continue;
    // -- One-time overdue mark: -assignedTaskLate the moment it passes due + grace --
    // Belt and braces on top of the dedupe key: an entry written before keys existed
    // carries only taskRef, so keying alone would not see it and would penalise the same
    // task twice after an upgrade. Drip entries share the source, so they are excluded
    // from this existence check by their key prefix.
    // eslint-disable-next-line no-await-in-loop
    const marked = await PointEntry.findOne({ taskRef: t._id, source: 'auto_task', dedupeKey: { $not: /^auto_overdue:/ } });
    if (pts && !marked) {
      // Same key the completion award uses, so the task's MAIN auto entry is replaced by
      // the result once it's finished. (The drips below are separate per-day entries.)
      // Filed under the day the due date passed — a July-due task's -5 lands in July,
      // however late the scan writes it.
      const overdueDay = overdueDayFor(t.dueYMD, b.graceDays);
      // eslint-disable-next-line no-await-in-loop
      await awardOnce(`auto_task:${t._id}`, { user: t.owner, month: overdueDay.slice(0, 7), points: -Math.abs(pts), reason: `Overdue: ${t.title}`, source: 'auto_task', taskRef: t._id, earnedYMD: overdueDay });
    }
    // -- Escalating drip: -N for each FURTHER day it stays overdue --
    // Timeline (grace 0): due day → nothing; due+1 → the -5 mark; due+2 onward → -1 each
    // day until the task is DONE — for an approval-gated task that means APPROVED, so the
    // drip keeps running while a submission waits. Today only (no retroactive fill; the
    // one-time backfill below covered the switch-on). Once finished these day entries
    // STAY — they were the price of those days — while the main entry flips to the
    // result. Drips apply only to tasks DUE on/after the August floor (the drip rule's
    // start); the -5 mark above has no floor.
    if (dripPts && t.dueYMD >= DRIP_FLOOR_YMD && today > addDays(duePlus, 1)) {
      // eslint-disable-next-line no-await-in-loop
      await awardOnce(`auto_overdue:${t._id}:${today}`, { user: t.owner, month: today.slice(0, 7), points: -Math.abs(dripPts), reason: `Still overdue: ${t.title}`, source: 'auto_task', taskRef: t._id, earnedYMD: today });
    }
  }
}

/**
 * One-time switch-on of the owner's 2026-08-08 overdue rule, so history matches it:
 * the -5 mark applies to EVERY assigned task whose due date passed unfinished (July-due
 * included — the earlier August floor on the mark is gone), and the per-day drip runs
 * for every day a task due on/after 1 Aug stayed unfinished — approval included, so days
 * a submission sat unapproved count too (the old scan skipped them). The daily scan only
 * writes "today", so this back-fills the missed drip days once; the marks themselves
 * need no backfill (the scan re-adds them, filed under the day the due date passed).
 * awardOnce's insert-only upsert makes re-running this harmless.
 */
async function backfillOverdueRuleV2() {
  const s = await Setting.getSingleton();
  if (s.bonus?.overdueRuleV2) return;
  const b = s.bonus || {};
  const dripPts = rulePoints(b, 'assignedTaskOverdueDaily');
  const today = ymdInTz(new Date());
  if (dripPts) {
    const forwardedParentIds = await Task.distinct('forwardedFrom', { forwardedFrom: { $ne: null } });
    const tasks = await Task.find({ assignedBy: { $ne: null }, dueYMD: { $gte: DRIP_FLOOR_YMD }, _id: { $nin: forwardedParentIds } })
      .select('owner dueYMD title status completedAt assignedBy collaborators forwardedFrom');
    const ownerIds = await ownerTierIds();
    const memo = new Map();
    for (const t of tasks) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await chainEligible(t, ownerIds, memo))) continue;
      const duePlus = addDays(t.dueYMD, b.graceDays || 0);
      const first = addDays(duePlus, 2); // day after the -5 mark
      // Drips stop the day the task reached DONE (= approval, for gated tasks); a still-
      // open task drips through today. Days are written under their own date/month.
      let last = today;
      if (t.status === 'DONE' && t.completedAt) {
        const doneYMD = ymdInTz(t.completedAt);
        if (prevDay(doneYMD) < last) last = prevDay(doneYMD);
      }
      for (let d = first; d <= last; d = addDays(d, 1)) {
        // eslint-disable-next-line no-await-in-loop
        await awardOnce(`auto_overdue:${t._id}:${d}`, { user: t.owner, month: d.slice(0, 7), points: -Math.abs(dripPts), reason: `Still overdue: ${t.title}`, source: 'auto_task', taskRef: t._id, earnedYMD: d });
      }
    }
  }
  s.bonus.overdueRuleV2 = true;
  await s.save();
  Setting.invalidateCache();
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
      // Label by the week-ENDING day (the Saturday this entry is filed under), not the
      // Monday it started. A week that straddles a month boundary (e.g. Mon 27 Jul → Sat
      // 1 Aug) is filed in the ending month; leading the label with the July Monday made
      // an August entry read as if July had leaked into the August breakdown.
      await awardOnce(`auto_streak:${u._id}:${start}`, { user: u._id, month: monthOfAward, points: Math.abs(pts), reason: `Punctual week ending ${end}`, source: 'auto_streak', earnedYMD: end });
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
    // Bounded to THIS month's completions. It used to load EVERY finished task (all months)
    // and skip the rest in JS — cheap once, but this backfill runs on the schedule, and
    // with the per-task forward-chain lookup that unbounded scan blew past the 30s timeout.
    const monthStart = companyDayFromYMD(from);
    const monthEndExclusive = companyDayFromYMD(`${nextMonth(month)}-01`);
    const tasks = await Task.find({ status: 'DONE', assignedBy: { $ne: null }, forwardedFrom: null, completedAt: { $gte: monthStart, $lt: monthEndExclusive } }).select('owner dueYMD title completedAt submittedAt requiresApproval assignedBy forwardedFrom collaborators');
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
  const done = b.historyScored || '';
  if (done >= target) return;

  const m = done ? nextMonth(done) : firstMonth;
  // Advance the watermark BEFORE the heavy backfill, ONE month per run. It used to be
  // written only AFTER backfilling two months — so if that overran the Lambda's 30s timeout
  // the watermark never moved, and this re-ran the same heavy month on EVERY scheduler tick,
  // pinning the function at 30s and hammering the DB (which is what slowed the whole app).
  // The month's live hooks already scored it as things happened; this pass is a best-effort
  // top-up, so marking it done up front — even if the backfill below is cut short — is safe
  // and guarantees the catch-up can never loop.
  await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.historyScored': m } });
  Setting.invalidateCache();
  try { await backfillMonth(m); } catch (e) { console.error('history backfill', m, 'failed', e?.message); }
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
    if (r.source === 'auto_streak' && day) {
      // A streak key ends in the week's MONDAY, but the award belongs to the week-ending
      // Saturday (Monday + 5) — the day it is filed under. Using the Monday would land a
      // straddling week in the wrong month.
      ymd = addDays(day[1], 5);
    } else if (day) {
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
// v2: catch tasks whose due date was corrected before the due-date-edit re-scoring shipped.
// forwarder-reward-v1: forwarding now pays the forwarder (+forwardOnTime / -forwardLate) and
// gates the whole chain on top approval, so every finished chain must be re-scored once.
const RESCORE_VERSION = 'forwarder-reward-v1';

/**
 * Seed the forwarding reward rules (forwardOnTime +3 / forwardLate 2) into the live config
 * once, so the feature works out of the box with the values leadership asked for — while
 * still showing up in Settings as ordinary, editable rules. Guarded by a flag so removing
 * them later doesn't make them re-appear. Missing keys only — never overwrites a value
 * leadership has already set.
 */
async function seedForwardRules() {
  const s = await Setting.getSingleton();
  if (s.bonus?.forwardRuleSeeded) return;
  const rules = [...(s.bonus.autoRules || [])];
  if (!rules.some((r) => r.key === 'forwardOnTime')) rules.push({ key: 'forwardOnTime', points: 3 });
  if (!rules.some((r) => r.key === 'forwardLate')) rules.push({ key: 'forwardLate', points: 2 });
  s.bonus.autoRules = rules;
  s.bonus.forwardRuleSeeded = true;
  await s.save();
  Setting.invalidateCache();
}

/**
 * Seed the escalating-overdue rule (assignedTaskOverdueDaily, 1 point/day) once, so the
 * drip works out of the box - editable/removable in Settings like any other rule, and the
 * flag stops it re-appearing after leadership removes it.
 */
/**
 * One-time: rewrite existing punctual-week labels to read by the week-ENDING day, matching
 * the new format. Old rows read "Punctual week · <Monday> to <Saturday>", which made a
 * month-straddling week look like it belonged to the previous month in the breakdown; this
 * aligns them to their earnedYMD (the Saturday they're already filed under). Guarded by a
 * flag so it runs once and never again.
 */
async function relabelStreakEntries() {
  const s = await Setting.getSingleton();
  if (s.bonus?.streakLabelFixed) return;
  await PointEntry.updateMany({ source: 'auto_streak', earnedYMD: { $ne: '' } }, [
    { $set: { reason: { $concat: ['Punctual week ending ', '$earnedYMD'] } } },
  ]);
  s.bonus.streakLabelFixed = true;
  await s.save();
  Setting.invalidateCache();
}

/**
 * One-time: put every punctual-week entry's DATE on its real week-ending Saturday.
 *
 * A streak's dedupe key ends in the week's MONDAY. An older repair pass copied that
 * Monday into earnedYMD (and the go-live clamp then dragged the first week's onto
 * 1 July) — so the breakdown showed "Punctual week ending 2026-07-01" (a Wednesday) and
 * "ending 2026-07-13" (a Monday). The award itself, its month and its points were always
 * right; only the displayed day was wrong. This recomputes earnedYMD = key-Monday + 5
 * (the Saturday) and rewrites the label to match. Month is deliberately untouched —
 * totals and carry-over must not move.
 */
async function fixStreakDates() {
  const s = await Setting.getSingleton();
  if (s.bonus?.streakDatesFixed) return;
  const rows = await PointEntry.find({ source: 'auto_streak' }).select('dedupeKey earnedYMD reason');
  for (const r of rows) {
    const mon = (r.dedupeKey || '').match(/(\d{4}-\d{2}-\d{2})$/)?.[1];
    if (!mon) continue;
    const sat = addDays(mon, 5);
    if (r.earnedYMD !== sat || r.reason !== `Punctual week ending ${sat}`) {
      // eslint-disable-next-line no-await-in-loop
      await PointEntry.updateOne({ _id: r._id }, { $set: { earnedYMD: sat, reason: `Punctual week ending ${sat}` } });
    }
  }
  s.bonus.streakDatesFixed = true;
  await s.save();
  Setting.invalidateCache();
}

async function seedOverdueDripRule() {
  const s = await Setting.getSingleton();
  if (s.bonus?.overdueDripSeeded) return;
  const rules = [...(s.bonus.autoRules || [])];
  if (!rules.some((r) => r.key === 'assignedTaskOverdueDaily')) rules.push({ key: 'assignedTaskOverdueDaily', points: 1 });
  s.bonus.autoRules = rules;
  s.bonus.overdueDripSeeded = true;
  await s.save();
  Setting.invalidateCache();
}

/**
 * Re-score every finished assigned task from the task table as it stands right now, so a
 * task's points always reflect its CURRENT due date, completion day and status — even if
 * those were changed directly in the database, outside the app's own hooks. Re-runs
 * onAssignedTaskDone, which replaces each task's entry in place and re-files its month, so
 * it's safe and idempotent.
 */
async function rescoreAllDoneAssigned() {
  // Only ROOT copies (nothing forwarded INTO them) award — they pay their whole forward
  // tree at once; a non-root copy is a no-op in onAssignedTaskDone, so don't even load it.
  //
  // BOUNDED to the last ~45 days: this daily pass exists to catch task dates changed
  // straight in the database, which only matters for CURRENT standings. Re-scoring years
  // of closed, unchanged history every day was pushing the scheduled Lambda to its 30s
  // timeout (and dragging the whole app down). App-driven edits still re-score instantly.
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const tasks = await Task.find({ status: 'DONE', assignedBy: { $ne: null }, completedAt: { $gte: cutoff }, forwardedFrom: null })
    .select('owner completedBy dueYMD title completedAt submittedAt requiresApproval assignedBy status forwardedFrom collaborators')
    .limit(5000);
  for (const t of tasks) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await onAssignedTaskDone(t);
    } catch (e) {
      // One bad task must never abort the whole pass — that would leave the version
      // watermark unset and re-run the entire re-score on every schedule tick.
      console.error('rescore task failed', String(t._id), e?.message);
    }
  }
}

/**
 * The one-time re-score after a scoring-rule change, gated by a version watermark.
 *
 * 'forwarder-reward-v1' ONLY changed how forwarded chains score (a non-forwarded task is
 * root == leaf and scores exactly as before), so it re-scores just the forward-chain
 * ROOTS — a tiny set that always finishes inside one invocation. That matters: if this
 * pass can't complete it never writes the watermark and re-runs on every schedule tick,
 * which is exactly what dragged the whole app down. The daily re-sync still covers
 * everything else.
 */
async function rescoreAssignedTasks(b) {
  if (b.rescoreVersion === RESCORE_VERSION) return;
  const forwardedParentIds = await Task.distinct('forwardedFrom', { forwardedFrom: { $ne: null } });
  if (forwardedParentIds.length) {
    const roots = await Task.find({ _id: { $in: forwardedParentIds }, forwardedFrom: null, status: 'DONE', assignedBy: { $ne: null }, completedAt: { $ne: null } })
      .select('owner completedBy dueYMD title completedAt submittedAt requiresApproval assignedBy status forwardedFrom collaborators')
      .limit(5000);
    for (const t of roots) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await onAssignedTaskDone(t);
      } catch (e) { console.error('rescore(forward) task failed', String(t._id), e?.message); }
    }
  }
  await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.rescoreVersion': RESCORE_VERSION } });
  Setting.invalidateCache();
}

/**
 * Remove auto_task points whose task no longer qualifies — deleted, un-done, or
 * un-assigned. The app's own delete / undo hooks handle changes made THROUGH the app in
 * real time; this is the safety net for changes made directly in the database (a task
 * deleted straight from the collection would otherwise leave its points on the Rewards
 * page forever, pointing at a task that no longer loads). Two cheap queries, so it can run
 * on every rewards load.
 */
async function pruneOrphanTaskEntries() {
  const TASK_SOURCES = ['auto_task', 'auto_forward'];
  const entries = await PointEntry.find({ source: { $in: TASK_SOURCES }, taskRef: { $ne: null } })
    .select('taskRef points')
    .limit(20000);
  if (!entries.length) return;
  const ids = [...new Set(entries.map((e) => String(e.taskRef)))];
  const tasks = await Task.find({ _id: { $in: ids }, assignedBy: { $ne: null } }).select('status assignedBy collaborators forwardedFrom');
  const byId = new Map(tasks.map((t) => [String(t._id), t]));
  const ownerIds = await ownerTierIds();
  const chainMemo = new Map();
  // Owner-tier visibility gate, retroactively: entries on a task whose chain nobody in
  // the owner tier can see (not their assignment, none of them tagged) are removed —
  // whatever the month. This is the pass that cleans history when the rule arrives (or
  // when a tag is taken off later).
  const eligibleById = new Map();
  for (const t of tasks) {
    // eslint-disable-next-line no-await-in-loop
    eligibleById.set(String(t._id), await chainEligible(t, ownerIds, chainMemo));
  }
  const dead = [];
  for (const e of entries) {
    const t = byId.get(String(e.taskRef));
    if (t && !eligibleById.get(String(t._id))) {
      dead.push(e._id);
      // eslint-disable-next-line no-continue
      continue;
    }
    // A COMPLETION result (positive) needs a task that's still DONE; a PENALTY (the
    // overdue mark and the per-day drips, all negative) is legitimate on a task that is
    // merely still PENDING - deleting those daily would re-date them on every re-add.
    const keep = t && (t.status === 'DONE' || e.points < 0);
    if (!keep) dead.push(e._id);
  }
  if (dead.length) await PointEntry.deleteMany({ _id: { $in: dead } });
}

/** Runs the daily scans + month rollup at most once a day (no cron needed). */
export async function maybeRunDaily() {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  if (!b.enabled) return;
  // Runs every tick (this whole job is scheduler-only now — see the /bonus/me controller).
  // Keep ONLY watermark-gated, self-terminating work here so a tick every few minutes stays
  // cheap; the collection-scanning one-offs moved into the once-a-day block below.
  //  - catchUpHistory: has its own watermark, shouldn't wait a day to backfill past months.
  //  - seedForwardRules / rescoreAssignedTasks: gated on flags/version, so a no-op once done
  //    (and the re-score must apply promptly, not a day later).
  try { await catchUpHistory(b); } catch (e) { console.error('history catch-up failed', e?.message); }
  try { await seedForwardRules(); } catch (e) { console.error('forward-rule seed failed', e?.message); }
  try { await seedOverdueDripRule(); } catch (e) { console.error('overdue-drip seed failed', e?.message); }
  try { await relabelStreakEntries(); } catch (e) { console.error('streak relabel failed', e?.message); }
  try { await fixStreakDates(); } catch (e) { console.error('streak date fix failed', e?.message); }
  try { await rescoreAssignedTasks(b); } catch (e) { console.error('task re-score failed', e?.message); }
  const today = ymdInTz(new Date());
  if (b.lastPenaltyRun === today) return;
  // Where the absence catch-up starts. Kept SEPARATE from the once-a-day throttle and
  // moved forward only after the scan actually succeeds: the throttle has to be written
  // immediately (it is what stops a second instance running the same day), but if it
  // doubled as the watermark then a scan that failed would have already declared its
  // days done and they would never be looked at again — the exact hole this catch-up
  // was added to close.
  const scanFrom = b.lastAbsenceScan || b.lastPenaltyRun || '';
  s.bonus.lastPenaltyRun = today; // throttle FIRST, so an overlapping tick can't double-run the heavy jobs below
  const rolled = await runMonthRollup(b).catch((e) => { console.error('month rollup failed', e?.message); return b.lastMonthRollup; });
  if (rolled) s.bonus.lastMonthRollup = rolled;
  await s.save();
  // ── Once a day from here down. These do collection scans / heavier queries, so they must
  //    NOT run on every few-minute tick (that recurring load is what slowed the whole app). ──
  try { await repairEarnedDates(); } catch (e) { console.error('earned-date repair failed', e?.message); }
  try { await consolidateOvertime(b); } catch (e) { console.error('overtime consolidation failed', e?.message); }
  try { await clampPreGoLive(); } catch (e) { console.error('pre-go-live clamp failed', e?.message); }
  // Drop points for tasks deleted / un-done straight in the database (self-heal). Once a day
  // is plenty — direct-DB deletes are rare, and it's a full distinct scan.
  try { await pruneOrphanTaskEntries(); } catch (e) { console.error('orphan prune failed', e?.message); }
  try { await backfillOverdueRuleV2(); } catch (e) { console.error('overdue rule-v2 backfill failed', e?.message); }
  try { await scanOverdueTasks(b); } catch (e) { console.error('overdue scan failed', e?.message); }
  // Once a day, re-sync every finished task's points with the task table, so a due date or
  // completion date changed directly in the database is reflected without waiting for an
  // in-app edit. (In-app edits already re-score at the moment they happen.)
  try { await rescoreAllDoneAssigned(); } catch (e) { console.error('daily task re-sync failed', e?.message); }
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
