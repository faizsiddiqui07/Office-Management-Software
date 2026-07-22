import { LeaveRequest } from '../models/LeaveRequest.js';
import { LeaveBalance } from '../models/LeaveBalance.js';
import { Attendance } from '../models/Attendance.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { joinedYMD } from '../lib/joining.js';
import { notify } from '../models/Notification.js';
import { can } from '../lib/permissions.js';
import { rolesWithPermission } from '../lib/roles.js';
import { companyDayFromYMD } from '../lib/time.js';
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
  }
  return bal;
}

export async function getBalanceForUser(userId) {
  const year = currentLeaveYear();
  const bal = await getOrCreateBalance(userId, year);
  return bal.toJSON();
}

/**
 * Leadership override (Users page): set an employee's leave quota and/or the
 * days they've already used for the CURRENT fiscal year. Used for mid-year
 * onboarding where leaves were taken before the system went live. `remaining`
 * is always recomputed from quota − used.
 */
export async function setLeaveBalance(userId, { totalQuota, used }) {
  const user = await User.findById(userId);
  if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');

  const year = currentLeaveYear();
  const bal = await getOrCreateBalance(userId, year);
  if (totalQuota !== undefined && totalQuota !== null) bal.totalQuota = Math.max(0, Math.round(totalQuota));
  if (used !== undefined && used !== null) bal.used = Math.max(0, Math.round(used));
  bal.remaining = bal.totalQuota - bal.used;
  await bal.save();
  return bal.toJSON();
}

export async function applyLeave(user, { type, startYMD, endYMD, halfDay, halfDayPart, reason }) {
  if (endYMD < startYMD) throw httpError(400, 'BAD_RANGE', 'End date is before the start date');
  if (halfDay && startYMD !== endYMD) {
    throw httpError(400, 'BAD_HALF_DAY', 'Half-day applies to a single date only');
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
  if (endYMD < startYMD) throw httpError(400, 'BAD_RANGE', 'End date is before the start date');

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

  // Overwrite any present/absent record in range so ON_LEAVE applies cleanly.
  await Attendance.deleteMany({
    user: userId,
    date: { $gte: companyDayFromYMD(startYMD), $lte: companyDayFromYMD(endYMD) },
  });

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
  return decideLeave(actor, req.id, 'APPROVE', 'Recorded by leadership');
}

async function markAttendanceOnLeave(userId, fromYMD, toYMD, halfDay, weekendDays, holidays, session) {
  const { workingDates } = computeWorkingDays({ fromYMD, toYMD, halfDay, weekendDays, holidays });
  for (const ymd of workingDates) {
    const day = companyDayFromYMD(ymd);
    // eslint-disable-next-line no-await-in-loop
    const existing = await Attendance.findOne({ user: userId, date: day }).session(session);
    if (!existing) {
      // eslint-disable-next-line no-await-in-loop
      await Attendance.create([{ user: userId, date: day, status: 'ON_LEAVE' }], { session });
    } else if (!existing.checkInAt) {
      existing.status = 'ON_LEAVE';
      // eslint-disable-next-line no-await-in-loop
      await existing.save({ session });
    }
    // If the user actually checked in that day, their real attendance is preserved.
  }
}

async function revertAttendanceOnLeave(userId, fromYMD, toYMD, halfDay, weekendDays, holidays, session) {
  const { workingDates } = computeWorkingDays({ fromYMD, toYMD, halfDay, weekendDays, holidays });
  for (const ymd of workingDates) {
    const day = companyDayFromYMD(ymd);
    // eslint-disable-next-line no-await-in-loop
    const att = await Attendance.findOne({ user: userId, date: day }).session(session);
    if (att && att.status === 'ON_LEAVE' && !att.checkInAt) {
      // eslint-disable-next-line no-await-in-loop
      await att.deleteOne({ session });
    }
  }
}

export async function decideLeave(approver, id, decision, note) {
  const request = await LeaveRequest.findById(id);
  if (!request) throw httpError(404, 'NOT_FOUND', 'Leave request not found');
  if (request.status !== 'PENDING') {
    throw httpError(409, 'ALREADY_DECIDED', `This request is already ${request.status.toLowerCase()}`);
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
    const year = leaveYearOf(fresh.startYMD);

    if (isPaid(fresh.type)) {
      const bal = await getOrCreateBalance(fresh.user, year, session);
      if (fresh.workingDays > bal.remaining) {
        throw httpError(
          400,
          'INSUFFICIENT_BALANCE',
          `Approving exceeds the employee's balance (remaining ${bal.remaining}, requested ${fresh.workingDays}). Reject it, or have them re-apply as unpaid.`,
        );
      }
      bal.used += fresh.workingDays;
      bal.remaining = bal.totalQuota - bal.used;
      await bal.save({ session });
    }

    await markAttendanceOnLeave(fresh.user, fresh.startYMD, fresh.endYMD, fresh.halfDay, ownerWeekends, holidays, session);

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

  const settings = await Setting.getSingleton();
  const holidays = await holidayYMDSet(request.startYMD, request.endYMD);
  const owner = await User.findById(request.user).select('employmentType schedule');
  const ownerWeekends = userWeekendDays(owner, settings);
  const result = await runTransaction(async (session) => {
    const fresh = await LeaveRequest.findById(id).session(session);
    const year = leaveYearOf(fresh.startYMD);

    if (isPaid(fresh.type)) {
      const bal = await getOrCreateBalance(fresh.user, year, session);
      bal.used = Math.max(0, bal.used - fresh.workingDays);
      bal.remaining = bal.totalQuota - bal.used;
      await bal.save({ session });
    }

    await revertAttendanceOnLeave(fresh.user, fresh.startYMD, fresh.endYMD, fresh.halfDay, ownerWeekends, holidays, session);

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
