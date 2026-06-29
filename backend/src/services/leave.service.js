import { LeaveRequest } from '../models/LeaveRequest.js';
import { LeaveBalance } from '../models/LeaveBalance.js';
import { Attendance } from '../models/Attendance.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { notify } from '../models/Notification.js';
import { can } from '../lib/permissions.js';
import { companyDayFromYMD } from '../lib/time.js';
import { computeWorkingDays } from './workingDays.service.js';
import { holidayYMDSet } from './holiday.service.js';
import { runTransaction } from '../lib/transaction.js';

const PAID_TYPES = ['CASUAL', 'SICK', 'PAID'];
const isPaid = (type) => PAID_TYPES.includes(type);

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

export async function getOrCreateBalance(userId, year, session = null) {
  let bal = await LeaveBalance.findOne({ user: userId, year }).session(session);
  if (!bal) {
    const settings = await Setting.getSingleton();
    const [created] = await LeaveBalance.create(
      [
        {
          user: userId,
          year,
          totalQuota: settings.annualLeaveQuota,
          used: 0,
          remaining: settings.annualLeaveQuota,
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
  const year = new Date().getFullYear();
  const bal = await getOrCreateBalance(userId, year);
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
    weekendDays: settings.weekendDays,
    holidays,
  });
  if (workingDays <= 0) throw httpError(400, 'NO_WORKING_DAYS', 'The selected dates contain no working days');

  const year = Number(startYMD.slice(0, 4));
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

  // Notify approvers.
  const approvers = await User.find({ isActive: true, role: { $in: ['CEO', 'DIRECTOR', 'MANAGER'] } }).select('_id');
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
  const result = await runTransaction(async (session) => {
    const fresh = await LeaveRequest.findById(id).session(session);
    if (fresh.status !== 'PENDING') {
      throw httpError(409, 'ALREADY_DECIDED', `Already ${fresh.status.toLowerCase()}`);
    }
    const year = Number(fresh.startYMD.slice(0, 4));

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

    await markAttendanceOnLeave(fresh.user, fresh.startYMD, fresh.endYMD, fresh.halfDay, settings.weekendDays, holidays, session);

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
  const result = await runTransaction(async (session) => {
    const fresh = await LeaveRequest.findById(id).session(session);
    const year = Number(fresh.startYMD.slice(0, 4));

    if (isPaid(fresh.type)) {
      const bal = await getOrCreateBalance(fresh.user, year, session);
      bal.used = Math.max(0, bal.used - fresh.workingDays);
      bal.remaining = bal.totalQuota - bal.used;
      await bal.save({ session });
    }

    await revertAttendanceOnLeave(fresh.user, fresh.startYMD, fresh.endYMD, fresh.halfDay, settings.weekendDays, holidays, session);

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
  const year = new Date().getFullYear();
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
