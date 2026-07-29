import mongoose from 'mongoose';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { LeaveBalance } from '../models/LeaveBalance.js';
import { Attendance } from '../models/Attendance.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { joinedYMD } from '../lib/joining.js';
import { notify } from '../models/Notification.js';
import { can, canAssignRole } from '../lib/permissions.js';
import { rolesWithPermission, roleLabel } from '../lib/roles.js';
import { companyDayFromYMD, ymdInTz } from '../lib/time.js';
import { leaveYearOf, currentLeaveYear } from '../lib/leaveYear.js';
import { APP_LIVE_YMD } from '../lib/appLive.js';
import { computeWorkingDays } from './workingDays.service.js';
import { holidayYMDSet } from './holiday.service.js';
import { userWeekendDays } from '../lib/schedule.js';
import { runTransaction } from '../lib/transaction.js';

const PAID_TYPES = ['CASUAL', 'SICK', 'PAID'];
const isPaid = (type) => PAID_TYPES.includes(type);

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/**
 * Leave is earned month by month (the yearly quota spread over 12), so somebody who
 * starts part-way through the leave year earns only the months they're actually here
 * for. Anyone already employed when the year began gets the full quota — how long
 * before that they joined makes no difference, because the quota resets every 1 April.
 *
 * Leave year `year` runs 1 April `year` → 31 March `year + 1`.
 *
 * EXISTING STAFF ARE EXEMPT from pro-rata entirely: anyone whose joining date is on
 * or before the day this system went live gets the full quota, whatever the date
 * says. Their stored dates are a mix of real history and "the day they got access",
 * and editing one back and forth was flipping quotas between 18 and 13.5 — a person's
 * leave must not depend on which version of their paperwork was typed in last.
 * Pro-rata applies only to people hired after the office started running on this.
 */
export function quotaForJoiner(joinedYMD, year, annualQuota) {
  if (!joinedYMD || joinedYMD <= APP_LIVE_YMD) return annualQuota;
  const joinYear = Number(joinedYMD.slice(0, 4));
  const joinMonth = Number(joinedYMD.slice(5, 7));
  // Months elapsed from the April this leave year started (Apr = 0 … Mar = 11).
  const sinceApril = (joinYear - year) * 12 + (joinMonth - 4);
  const monthsHere = Math.max(0, Math.min(12, 12 - sinceApril));
  if (monthsHere >= 12) return annualQuota; // already here when the year began
  // Round to the nearest half day — the accrual itself is 1.5/month.
  return Math.round(((monthsHere * annualQuota) / 12) * 2) / 2;
}

export async function getOrCreateBalance(userId, year, session = null) {
  let bal = await LeaveBalance.findOne({ user: userId, year }).session(session);
  if (!bal) {
    const settings = await Setting.getSingleton();
    const user = await User.findById(userId).select('dateOfJoining').session(session);
    const quota = quotaForJoiner(joinedYMD(user), year, settings.annualLeaveQuota);
    try {
      const [created] = await LeaveBalance.create(
        [
          {
            user: userId,
            year,
            totalQuota: quota,
            used: 0,
            remaining: quota,
            overtimeMinutes: 0,
          },
        ],
        { session },
      );
      bal = created;
    } catch (err) {
      // Two requests can look for the same missing balance at once — the PWA fires
      // several on resume, and on 1 April every one of them finds the new year's row
      // absent. The unique {user, year} index means the loser of that race gets a
      // duplicate-key error; the row it wanted now exists, so read it instead of
      // failing the whole dashboard with a 500.
      if (err?.code !== 11000) throw err;
      bal = await LeaveBalance.findOne({ user: userId, year }).session(session);
      if (!bal) throw err;
    }
  }
  return bal;
}

/**
 * Overtime for a leave year, summed from the attendance days themselves.
 *
 * LeaveBalance carries an `overtimeMinutes` column, but only self-checkout ever added
 * to it — a corrected check-out, a leadership edit or a cleared day changed the day and
 * left the total behind, so it drifted. Nothing writes it any more; every screen that
 * shows "overtime this year" gets the figure from here, where it cannot disagree with
 * the days it is meant to summarise.
 */
export async function overtimeMinutesForYear(userId, year) {
  const [agg] = await Attendance.aggregate([
    {
      $match: {
        user: typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId,
        date: { $gte: companyDayFromYMD(`${year}-04-01`), $lte: companyDayFromYMD(`${year + 1}-03-31`) },
      },
    },
    { $group: { _id: null, minutes: { $sum: '$overtimeMinutes' } } },
  ]);
  return agg?.minutes ?? 0;
}

/** A balance as the UI reads it — with the overtime figure derived, never stored. */
export async function balanceJSON(userId, year) {
  const bal = await getOrCreateBalance(userId, year);
  return { ...bal.toJSON(), overtimeMinutes: await overtimeMinutesForYear(userId, year) };
}

export async function getBalanceForUser(userId) {
  return balanceJSON(userId, currentLeaveYear());
}

/**
 * One employee's leave ledger for a fiscal year (Apr–Mar): the balance, a by-type
 * summary of what was approved, and every request that touches the year. Shaped for the
 * PDF renderer (renderLeaveLedgerToStream). `year` is the starting calendar year.
 */
export async function buildLeaveLedger(user, year = currentLeaveYear()) {
  const from = `${year}-04-01`;
  const to = `${year + 1}-03-31`;
  const settings = await Setting.getSingleton();
  // Read-only: a DOWNLOAD must never create or lock a balance row. Creating one here
  // would freeze that year's quota at today's setting — and let anyone pre-seed a future
  // year's balance just by requesting its ledger. If no row exists yet (a year with no
  // activity), show the quota it WOULD open with, without persisting anything.
  let bal = await LeaveBalance.findOne({ user: user._id, year });
  if (!bal) {
    const quota = quotaForJoiner(joinedYMD(user), year, settings.annualLeaveQuota);
    bal = { totalQuota: quota, used: 0, remaining: quota };
  }

  // Every request that overlaps the year, newest first.
  const reqs = await LeaveRequest.find({ user: user._id, startYMD: { $lte: to }, endYMD: { $gte: from } }).sort({ startYMD: -1 });
  const byType = {};
  for (const l of reqs) {
    if (l.status === 'APPROVED') byType[l.type] = (byType[l.type] || 0) + (l.workingDays || 0);
  }

  return {
    company: { name: settings.companyName, currency: settings.currency, timezone: settings.timezone, brandColor: settings.brandColor, logoUrl: settings.logoUrl, logoLight: settings.logoLight, logoDark: settings.logoDark },
    generatedAt: new Date().toISOString(),
    period: { from, to, label: `FY ${year}–${String(year + 1).slice(2)}` },
    subject: { name: user.name, employeeId: user.employeeId, role: user.role, roleLabel: roleLabel(user.role), department: user.department || '' },
    balance: {
      totalQuota: bal.totalQuota,
      used: bal.used,
      remaining: bal.remaining,
      overtimeMinutes: await overtimeMinutesForYear(user._id, year),
    },
    byType,
    leaves: reqs.map((l) => ({
      type: l.type,
      status: l.status,
      startYMD: l.startYMD,
      endYMD: l.endYMD,
      halfDay: !!l.halfDay,
      days: l.workingDays,
      reason: l.reason || '',
      appliedYMD: l.appliedAt ? ymdInTz(l.appliedAt) : '',
    })),
  };
}

/**
 * Leadership override (Users page): set an employee's leave quota and/or the
 * days they've already used for the CURRENT fiscal year. Used for mid-year
 * onboarding where leaves were taken before the system went live. `remaining`
 * is always recomputed from quota − used.
 */
export async function setLeaveBalance(actor, userId, { totalQuota, used }) {
  const user = await User.findById(userId);
  if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');
  // Same rank guard the Users routes enforce: you may only override the balance of
  // someone at your own tier or below — never a senior. Without this a junior
  // manageUsers holder could zero out the CEO's quota (or self-grant unlimited leave).
  if (!canAssignRole(actor.role, user.role)) {
    throw httpError(403, 'FORBIDDEN', 'You cannot change the leave balance of a user senior to you');
  }

  const year = currentLeaveYear();
  const bal = await getOrCreateBalance(userId, year);
  if (totalQuota !== undefined && totalQuota !== null) bal.totalQuota = Math.max(0, Math.round(totalQuota));
  if (used !== undefined && used !== null) bal.used = Math.max(0, Math.round(used));
  bal.remaining = bal.totalQuota - bal.used;
  await bal.save();
  return bal.toJSON();
}

/**
 * An active (PENDING/APPROVED) leave for this user that overlaps [startYMD, endYMD].
 * `excludeId` skips one request (used when editing that same request). Two date ranges
 * overlap when each starts on or before the other ends. Prevents the same physical
 * absence being applied — and its balance deducted — more than once.
 */
/**
 * A leave has to sit inside ONE leave year. The balance it is charged against is
 * picked from the start date, so a request running 30 March → 3 April would take all
 * of its days out of the OLD year's quota — it could be refused for want of balance
 * while the fresh quota that opens on 1 April sits untouched, and the days would be
 * filed under a year most of them don't belong to. Splitting the deduction across two
 * balances would make every later step (approve, cancel, restore) ambiguous, so the
 * request is refused instead, with an explanation of what to do.
 */
function assertSingleLeaveYear(startYMD, endYMD) {
  const y = leaveYearOf(startYMD);
  if (y === leaveYearOf(endYMD)) return;
  throw httpError(
    400,
    'SPANS_LEAVE_YEAR',
    `The leave year ends on 31 March, and these dates cross it. Apply twice — up to ${y + 1}-03-31, and again from ${y + 1}-04-01 — so each part comes out of the right year's balance.`,
  );
}

async function findOverlappingLeave(userId, startYMD, endYMD, excludeId = null) {
  const filter = {
    user: userId,
    status: { $in: ['PENDING', 'APPROVED'] },
    startYMD: { $lte: endYMD },
    endYMD: { $gte: startYMD },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return LeaveRequest.findOne(filter);
}

export async function applyLeave(user, { type, startYMD, endYMD, halfDay, halfDayPart, reason }) {
  if (endYMD < startYMD) throw httpError(400, 'BAD_RANGE', 'End date is before the start date');
  if (halfDay && startYMD !== endYMD) {
    throw httpError(400, 'BAD_HALF_DAY', 'Half-day applies to a single date only');
  }
  assertSingleLeaveYear(startYMD, endYMD);

  // Block a second request over days already covered by an active one — otherwise the
  // same absence can be approved twice and the balance charged twice.
  if (await findOverlappingLeave(user._id, startYMD, endYMD)) {
    throw httpError(409, 'LEAVE_EXISTS', 'You already have a leave request covering those dates. Cancel or edit it instead of applying again.');
  }

  const settings = await Setting.getSingleton();
  const holidays = await holidayYMDSet(startYMD, endYMD);
  const { count: workingDays } = computeWorkingDays({
    fromYMD: startYMD,
    toYMD: endYMD,
    halfDay,
    weekendDays: userWeekendDays(user, settings),
    holidays,
  });
  if (workingDays <= 0) throw httpError(400, 'NO_WORKING_DAYS', 'The selected dates contain no working days');

  const year = leaveYearOf(startYMD);
  if (isPaid(type)) {
    const bal = await getOrCreateBalance(user._id, year);
    if (workingDays > bal.remaining) {
      throw httpError(
        400,
        'INSUFFICIENT_BALANCE',
        `Not enough leave balance (remaining ${bal.remaining}, requested ${workingDays}). Apply as Unpaid (LOP) instead.`,
      );
    }
  }

  const request = await LeaveRequest.create({
    user: user._id,
    type,
    startDate: companyDayFromYMD(startYMD),
    endDate: companyDayFromYMD(endYMD),
    startYMD,
    endYMD,
    halfDay: !!halfDay,
    halfDayPart: halfDay ? halfDayPart || 'FIRST' : null,
    workingDays,
    reason: reason || '',
    status: 'PENDING',
    appliedAt: new Date(),
  });

  // In-app notification to whoever approves leave (CEO & President). Target by the
  // approveLeave permission — not hardcoded role keys — so it works with custom roles.
  const approverRoles = rolesWithPermission('approveLeave');
  const approvers = await User.find({
    isActive: true,
    role: { $in: approverRoles.length ? approverRoles : ['CEO', 'DIRECTOR'] },
    _id: { $ne: user._id },
  }).select('name');

  await Promise.all(
    approvers.map((a) =>
      notify({
        user: a._id,
        type: 'LEAVE_REQUEST',
        title: 'New leave request',
        message: `${user.name} requested ${workingDays} day(s) of ${type.toLowerCase()} leave`,
        link: '/leaves',
      }),
    ),
  );

  return request.toJSON();
}

/**
 * Edit a PENDING leave request (the applicant fixing a mistake). Only the owner
 * may edit, and only while it's still pending — once decided, the balance and
 * attendance are already applied, so it can't be edited (cancel + re-apply).
 * Re-validates dates, working days and balance exactly like applyLeave.
 */
export async function updateLeave(user, id, { type, startYMD, endYMD, halfDay, halfDayPart, reason }) {
  const request = await LeaveRequest.findById(id);
  if (!request) throw httpError(404, 'NOT_FOUND', 'Leave request not found');
  if (String(request.user) !== String(user._id)) {
    throw httpError(403, 'FORBIDDEN', 'You can only edit your own leave request');
  }
  if (request.status !== 'PENDING') {
    throw httpError(409, 'NOT_EDITABLE', `This request is already ${request.status.toLowerCase()} and can no longer be edited`);
  }
  if (endYMD < startYMD) throw httpError(400, 'BAD_RANGE', 'End date is before the start date');
  if (halfDay && startYMD !== endYMD) throw httpError(400, 'BAD_HALF_DAY', 'Half-day applies to a single date only');
  assertSingleLeaveYear(startYMD, endYMD);

  // Same overlap guard as applyLeave, ignoring THIS request so an edit that keeps the
  // same dates isn't blocked by itself.
  if (await findOverlappingLeave(user._id, startYMD, endYMD, request._id)) {
    throw httpError(409, 'LEAVE_EXISTS', 'You already have another leave request covering those dates.');
  }

  const settings = await Setting.getSingleton();
  const holidays = await holidayYMDSet(startYMD, endYMD);
  const { count: workingDays } = computeWorkingDays({
    fromYMD: startYMD,
    toYMD: endYMD,
    halfDay,
    weekendDays: userWeekendDays(user, settings),
    holidays,
  });
  if (workingDays <= 0) throw httpError(400, 'NO_WORKING_DAYS', 'The selected dates contain no working days');

  // Pending requests haven't consumed balance yet, so the full remaining applies.
  if (isPaid(type)) {
    const bal = await getOrCreateBalance(user._id, leaveYearOf(startYMD));
    if (workingDays > bal.remaining) {
      throw httpError(
        400,
        'INSUFFICIENT_BALANCE',
        `Not enough leave balance (remaining ${bal.remaining}, requested ${workingDays}). Apply as Unpaid (LOP) instead.`,
      );
    }
  }

  request.type = type;
  request.startDate = companyDayFromYMD(startYMD);
  request.endDate = companyDayFromYMD(endYMD);
  request.startYMD = startYMD;
  request.endYMD = endYMD;
  request.halfDay = !!halfDay;
  request.halfDayPart = halfDay ? halfDayPart || 'FIRST' : null;
  request.workingDays = workingDays;
  request.reason = reason || '';
  await request.save();
  return request.toJSON();
}

/**
 * Leadership records a leave FOR an employee (e.g. from the attendance editor)
 * and auto-approves it — deducts balance, marks the day(s) ON_LEAVE, and shows
 * up in the employee's leave history like any approved leave. Any existing
 * check-in on those days is cleared (they're on leave now).
 */
export async function recordLeaveForUser(actor, userId, { type, startYMD, endYMD, reason }) {
  const target = await User.findById(userId);
  if (!target) throw httpError(404, 'NOT_FOUND', 'User not found');
  // Recording auto-approves, so recording it for yourself is self-approval by another
  // door. Apply normally and let another approver decide.
  if (String(userId) === String(actor._id)) {
    throw httpError(403, 'SELF_DECISION', 'You cannot record your own leave — apply for it so someone else can approve it');
  }
  if (endYMD < startYMD) throw httpError(400, 'BAD_RANGE', 'End date is before the start date');
  assertSingleLeaveYear(startYMD, endYMD); // same rule as applying — one leave year per request

  // Don't double-book: block if an active leave already covers any of these days.
  const overlap = await LeaveRequest.findOne({
    user: userId,
    status: { $in: ['PENDING', 'APPROVED'] },
    startYMD: { $lte: endYMD },
    endYMD: { $gte: startYMD },
  });
  if (overlap) {
    throw httpError(409, 'LEAVE_EXISTS', 'This person already has a leave covering that date — manage it from the Leaves page');
  }

  const settings = await Setting.getSingleton();
  const holidays = await holidayYMDSet(startYMD, endYMD);
  const { count: workingDays } = computeWorkingDays({
    fromYMD: startYMD,
    toYMD: endYMD,
    weekendDays: userWeekendDays(target, settings),
    holidays,
  });
  if (workingDays <= 0) throw httpError(400, 'NO_WORKING_DAYS', 'The selected dates contain no working days');

  if (isPaid(type)) {
    const bal = await getOrCreateBalance(target._id, leaveYearOf(startYMD));
    if (workingDays > bal.remaining) {
      throw httpError(400, 'INSUFFICIENT_BALANCE', `Not enough leave balance (remaining ${bal.remaining}, requested ${workingDays}).`);
    }
  }

  // The existing attendance for these days is cleared as PART OF the approval below
  // (see decideLeave's `replaceAttendance`), not before it. Deleting it here meant a
  // failed approval — a balance that changed underneath, a transaction that rolled
  // back — left the leave unrecorded while the employee's real check-ins for those
  // days were already gone for good.

  // Create as PENDING then approve — reuses the balance + attendance machinery.
  const req = await LeaveRequest.create({
    user: target._id,
    type,
    startDate: companyDayFromYMD(startYMD),
    endDate: companyDayFromYMD(endYMD),
    startYMD,
    endYMD,
    halfDay: false,
    halfDayPart: null,
    workingDays,
    reason: reason || 'Recorded by leadership',
    status: 'PENDING',
    appliedAt: new Date(),
  });
  // `replaceAttendance` clears whatever was recorded for those days inside the same
  // transaction, so leadership's "they were on leave" wins over an existing check-in.
  return decideLeave(actor, req.id, 'APPROVE', 'Recorded by leadership', { replaceAttendance: true });
}

/**
 * Mark the leave's days off, and report how many were ACTUALLY marked.
 *
 * A day the person really checked in on is left exactly as it is — they worked it. The
 * count that comes back is what the approval charges, so the balance can only ever be
 * charged for days the sheet agrees they were away. Charging the computed total instead
 * meant somebody who came in anyway (or whose leave was approved after they had already
 * worked the day) paid for a day the sheet still shows them present for.
 */
async function markAttendanceOnLeave(userId, fromYMD, toYMD, halfDay, weekendDays, holidays, session) {
  const { workingDates } = computeWorkingDays({ fromYMD, toYMD, halfDay, weekendDays, holidays });
  let marked = 0;
  for (const ymd of workingDates) {
    const day = companyDayFromYMD(ymd);
    // eslint-disable-next-line no-await-in-loop
    const existing = await Attendance.findOne({ user: userId, date: day }).session(session);
    if (!existing) {
      // eslint-disable-next-line no-await-in-loop
      await Attendance.create([{ user: userId, date: day, status: 'ON_LEAVE', halfDayLeave: !!halfDay }], { session });
      marked += 1;
    } else if (!existing.checkInAt) {
      existing.status = 'ON_LEAVE';
      // Half a day off is half a day off on the sheet too. The balance is charged 0.5
      // for it, so recording the date as a whole day away had the two records
      // disagreeing about the same day.
      existing.halfDayLeave = !!halfDay;
      // eslint-disable-next-line no-await-in-loop
      await existing.save({ session });
      marked += 1;
    }
    // If the user actually checked in that day, their real attendance is preserved —
    // and it isn't charged either.
  }
  // A half-day is a single date worth 0.5.
  return halfDay && workingDates.length === 1 ? marked * 0.5 : marked;
}

/**
 * Undo the ON_LEAVE marks a leave put down. Sweeps the whole date range rather than
 * recomputing which days were working days: the holiday set or the person's schedule
 * may have changed since the approval, and recomputing would then miss a day it had
 * actually marked, stranding an ON_LEAVE record on a cancelled leave. Only untouched
 * ON_LEAVE rows are removed, so real attendance is never destroyed.
 */
async function revertAttendanceOnLeave(userId, fromYMD, toYMD, session) {
  await Attendance.deleteMany(
    {
      user: userId,
      date: { $gte: companyDayFromYMD(fromYMD), $lte: companyDayFromYMD(toYMD) },
      status: 'ON_LEAVE',
      $or: [{ checkInAt: null }, { checkInAt: { $exists: false } }],
    },
    { session },
  );
}

export async function decideLeave(approver, id, decision, note, { replaceAttendance = false } = {}) {
  const request = await LeaveRequest.findById(id);
  if (!request) throw httpError(404, 'NOT_FOUND', 'Leave request not found');
  if (request.status !== 'PENDING') {
    throw httpError(409, 'ALREADY_DECIDED', `This request is already ${request.status.toLowerCase()}`);
  }
  // Nobody signs off their own leave. A role that can both apply and approve (an office
  // manager, say) would otherwise grant itself leave straight from the queue, which is
  // exactly the oversight this module exists to provide. Their request goes to another
  // approver — leadership always holds approveLeave.
  if (String(request.user) === String(approver._id)) {
    throw httpError(403, 'SELF_DECISION', 'You cannot decide your own leave request — someone else has to review it');
  }

  if (decision === 'REJECT') {
    request.status = 'REJECTED';
    request.decidedBy = approver._id;
    request.decidedAt = new Date();
    request.decisionNote = note || '';
    await request.save();
    await notify({
      user: request.user,
      type: 'LEAVE_DECISION',
      title: 'Leave rejected',
      message: `Your ${request.type.toLowerCase()} leave request was rejected`,
      link: '/leaves',
    });
    return request.toJSON();
  }

  const settings = await Setting.getSingleton();
  const holidays = await holidayYMDSet(request.startYMD, request.endYMD);
  // The leave owner's own working days (a part-timer's off-days aren't "on leave").
  const owner = await User.findById(request.user).select('employmentType schedule');
  const ownerWeekends = userWeekendDays(owner, settings);
  const result = await runTransaction(async (session) => {
    const fresh = await LeaveRequest.findById(id).session(session);
    if (fresh.status !== 'PENDING') {
      throw httpError(409, 'ALREADY_DECIDED', `Already ${fresh.status.toLowerCase()}`);
    }
    // Safety net for the check-then-act race: two overlapping requests can both slip
    // past applyLeave's overlap check when submitted concurrently, but only one may be
    // APPROVED. If another approved leave already covers these days, abort — otherwise
    // the same absence would deduct balance twice. (Paid approvals also contend on the
    // shared balance doc, so the loser here retries and sees this clash.)
    const clash = await LeaveRequest.findOne({
      _id: { $ne: fresh._id },
      user: fresh.user,
      status: 'APPROVED',
      startYMD: { $lte: fresh.endYMD },
      endYMD: { $gte: fresh.startYMD },
    }).session(session);
    if (clash) {
      throw httpError(409, 'LEAVE_EXISTS', 'Another approved leave already covers those dates. Cancel it first if this should replace it.');
    }
    const year = leaveYearOf(fresh.startYMD);

    // Leadership recording a leave FOR someone overrides whatever was on those days.
    // Done here, in the transaction, so a failure further down puts the attendance
    // back instead of destroying real check-ins for a leave that never got recorded.
    if (replaceAttendance) {
      await Attendance.deleteMany(
        { user: fresh.user, date: { $gte: companyDayFromYMD(fresh.startYMD), $lte: companyDayFromYMD(fresh.endYMD) } },
        { session },
      );
    }

    // Mark the days off FIRST, then charge for exactly what got marked.
    //
    // The figure stored at apply time is stale by now — a holiday may have been
    // declared, or the person's schedule changed. And days they actually checked in on
    // are deliberately left alone (they worked them), so charging a recomputed total
    // would still bill for days the sheet shows them present for. Taking the count from
    // the marking itself is the only version where the balance and the attendance
    // cannot disagree.
    const days = await markAttendanceOnLeave(fresh.user, fresh.startYMD, fresh.endYMD, fresh.halfDay, ownerWeekends, holidays, session);
    if (days <= 0) {
      throw httpError(409, 'NO_WORKING_DAYS', 'There is nothing left to approve on those dates — they are holidays, non-working days, or days already worked. Reject the request instead.');
    }
    fresh.workingDays = days; // what cancelling will put back

    if (isPaid(fresh.type)) {
      const bal = await getOrCreateBalance(fresh.user, year, session);
      if (days > bal.remaining) {
        throw httpError(
          400,
          'INSUFFICIENT_BALANCE',
          `Approving exceeds the employee's balance (remaining ${bal.remaining}, requested ${days}). Reject it, or have them re-apply as unpaid.`,
        );
      }
      bal.used += days;
      bal.remaining = bal.totalQuota - bal.used;
      await bal.save({ session });
    }

    fresh.status = 'APPROVED';
    fresh.decidedBy = approver._id;
    fresh.decidedAt = new Date();
    fresh.decisionNote = note || '';
    await fresh.save({ session });
    return fresh;
  });

  await notify({
    user: result.user,
    type: 'LEAVE_DECISION',
    title: 'Leave approved',
    message: `Your ${result.type.toLowerCase()} leave (${result.workingDays} day(s)) was approved`,
    link: '/leaves',
  });
  return result.toJSON();
}

export async function cancelLeave(viewer, id) {
  const request = await LeaveRequest.findById(id);
  if (!request) throw httpError(404, 'NOT_FOUND', 'Leave request not found');
  if (['CANCELLED', 'REJECTED'].includes(request.status)) {
    throw httpError(409, 'ALREADY_FINAL', `This request is already ${request.status.toLowerCase()}`);
  }

  const isOwner = String(request.user) === String(viewer._id);
  const isApprover = can(viewer, 'approveLeave');

  if (request.status === 'PENDING') {
    if (!isOwner && !isApprover) throw httpError(403, 'FORBIDDEN', 'You cannot cancel this request');
    request.status = 'CANCELLED';
    request.decidedBy = viewer._id;
    request.decidedAt = new Date();
    await request.save();
    return request.toJSON();
  }

  // APPROVED → only an approver can cancel; restore balance + revert attendance.
  if (!isApprover) throw httpError(403, 'FORBIDDEN', 'Only an approver can cancel an approved leave');
  // …and not your own: undoing the decision someone else made on your leave (putting the
  // days back in your own balance) is the same self-dealing as approving it yourself.
  if (isOwner) {
    throw httpError(403, 'SELF_DECISION', 'You cannot cancel your own approved leave — ask another approver to do it');
  }

  const result = await runTransaction(async (session) => {
    const fresh = await LeaveRequest.findById(id).session(session);
    // Re-check inside the transaction so two cancels racing each other can't each put
    // the same days back into the balance.
    if (fresh.status !== 'APPROVED') {
      throw httpError(409, 'ALREADY_FINAL', `This request is already ${fresh.status.toLowerCase()}`);
    }
    const year = leaveYearOf(fresh.startYMD);

    if (isPaid(fresh.type)) {
      const bal = await getOrCreateBalance(fresh.user, year, session);
      // workingDays is what the approval actually charged (recomputed and stored then),
      // so this puts back exactly what was taken.
      bal.used = Math.max(0, bal.used - fresh.workingDays);
      bal.remaining = bal.totalQuota - bal.used;
      await bal.save({ session });
    }

    await revertAttendanceOnLeave(fresh.user, fresh.startYMD, fresh.endYMD, session);

    fresh.status = 'CANCELLED';
    fresh.decidedBy = viewer._id;
    fresh.decidedAt = new Date();
    await fresh.save({ session });
    return fresh;
  });

  await notify({
    user: result.user,
    type: 'LEAVE_CANCELLED',
    title: 'Leave cancelled',
    message: `Your approved ${result.type.toLowerCase()} leave was cancelled and your balance restored`,
    link: '/leaves',
  });
  return result.toJSON();
}

/**
 * Remove a request outright — for the "I sent that by mistake" case, where cancelling
 * still leaves a row sitting in the list.
 *
 * Deliberately narrow: ONLY the person who raised it, and only while nobody else has
 * acted on it. A request is a record between two people — once it has been approved,
 * rejected or cancelled by someone else, erasing it would destroy the evidence that it
 * ever existed. That cuts both ways: an approver must not be able to delete a request
 * and later say it was never sent, and an employee must not be able to delete a
 * rejection. Approvers already have Reject and Cancel, which settle a request while
 * keeping the record.
 *
 * An APPROVED leave is never deletable anyway: approving deducted the balance and wrote
 * the attendance days, so removing the row would strand both.
 */
export async function deleteLeave(viewer, id) {
  const request = await LeaveRequest.findById(id);
  if (!request) throw httpError(404, 'NOT_FOUND', 'Leave request not found');

  if (String(request.user) !== String(viewer._id)) {
    throw httpError(403, 'FORBIDDEN', 'Only the person who raised a request can delete it');
  }

  if (request.status === 'APPROVED') {
    throw httpError(
      409,
      'APPROVED_LEAVE',
      'This leave is already approved — ask for it to be cancelled instead, so your balance and attendance are put back.',
    );
  }

  // decidedBy is set by whoever acted. Their own cancellation is fine; anyone else's
  // decision makes this a shared record that has to stay.
  if (request.decidedBy && String(request.decidedBy) !== String(viewer._id)) {
    throw httpError(
      409,
      'ALREADY_REVIEWED',
      'This request has already been reviewed, so it stays on the record. You can only delete a request nobody has acted on.',
    );
  }

  await request.deleteOne();
  return { success: true };
}

export async function listLeaves(viewer, { status, userId, from, to, queue }) {
  const isApprover = can(viewer, 'approveLeave');
  const filter = {};

  if (queue && isApprover) {
    // all requests (the approval queue)
  } else if (userId && isApprover) {
    filter.user = userId;
  } else {
    filter.user = viewer._id; // privacy default
  }

  if (status) filter.status = status;
  if (from || to) {
    filter.startYMD = {};
    if (from) filter.startYMD.$gte = from;
    if (to) filter.startYMD.$lte = to;
  }

  const requests = await LeaveRequest.find(filter)
    .sort({ appliedAt: -1 })
    .limit(200)
    .populate('user', 'name employeeId role department')
    .populate('decidedBy', 'name');

  // Attach each requester's current remaining (for the inline queue display).
  const year = currentLeaveYear();
  const userIds = [...new Set(requests.map((r) => String(r.user?._id ?? r.user)))];
  const balances = await LeaveBalance.find({ user: { $in: userIds }, year });
  const balByUser = new Map(balances.map((b) => [String(b.user), b]));

  return requests.map((r) => {
    const obj = r.toJSON();
    const bal = balByUser.get(String(r.user?._id ?? r.user));
    obj.requesterRemaining = bal ? bal.remaining : null;
    obj.requesterQuota = bal ? bal.totalQuota : null;
    return obj;
  });
}
