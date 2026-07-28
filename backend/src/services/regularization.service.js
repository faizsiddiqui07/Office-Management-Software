import { Regularization } from '../models/Regularization.js';
import { Attendance } from '../models/Attendance.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { Setting } from '../models/Setting.js';
import { User } from '../models/User.js';
import { notify } from '../models/Notification.js';
import { LEADERSHIP } from '../lib/permissions.js';
import { companyDayFromYMD, companyDayInstantAt, isLateCheckIn, computeWork } from '../lib/time.js';
import { effectiveSchedule } from '../lib/schedule.js';

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/**
 * An approved leave covering `dateYMD`, if there is one.
 *
 * A day can be leave or it can be worked — never both. The manual attendance editor
 * already refuses to touch an ON_LEAVE day ("cancel the leave first"); corrections have
 * to hold the same line, or approving one silently overwrites the ON_LEAVE marker while
 * the leave request and the deducted balance stay put, counting the day twice.
 */
async function approvedLeaveOn(userId, dateYMD) {
  return LeaveRequest.findOne({
    user: userId,
    status: 'APPROVED',
    startYMD: { $lte: dateYMD },
    endYMD: { $gte: dateYMD },
  });
}

export async function createRequest(user, { dateYMD, checkIn, checkOut, reason }) {
  if (!checkIn && !checkOut) {
    throw httpError(400, 'INVALID', 'Provide a check-in time, a check-out time, or both');
  }
  const dup = await Regularization.findOne({ user: user._id, dateYMD, status: 'PENDING' });
  if (dup) throw httpError(409, 'DUPLICATE', 'You already have a pending correction for this date');
  if (await approvedLeaveOn(user._id, dateYMD)) {
    throw httpError(409, 'ON_LEAVE', 'You were on approved leave that day. Ask for the leave to be cancelled first, then request the correction.');
  }

  const reg = await Regularization.create({
    user: user._id,
    dateYMD,
    date: companyDayFromYMD(dateYMD),
    requestedCheckIn: checkIn || null,
    requestedCheckOut: checkOut || null,
    reason,
  });

  const leaders = await User.find({ role: { $in: LEADERSHIP }, isActive: true }).select('_id');
  await Promise.all(
    leaders.map((l) =>
      notify({
        user: l._id,
        type: 'REGULARIZATION',
        title: `${user.name} requested an attendance correction`,
        message: `For ${dateYMD}`,
        link: '/attendance?tab=corrections',
      }),
    ),
  );

  return reg.toJSON();
}

export async function listForUser(userId) {
  const regs = await Regularization.find({ user: userId }).sort({ createdAt: -1 }).limit(50);
  return regs.map((r) => r.toJSON());
}

export async function listPending() {
  const regs = await Regularization.find({ status: 'PENDING' }).sort({ createdAt: 1 }).populate('user', 'name employeeId role');
  return regs.map((r) => r.toJSON());
}

/** Decided (approved/rejected) corrections — the review history for leadership. */
export async function listHistory() {
  const regs = await Regularization.find({ status: { $in: ['APPROVED', 'REJECTED'] } })
    .sort({ decidedAt: -1 })
    .limit(100)
    .populate('user', 'name employeeId role')
    .populate('decidedBy', 'name');
  return regs.map((r) => r.toJSON());
}

/**
 * Delete a correction record (e.g. a mistaken or duplicate entry). This removes
 * only the request/history row — it does NOT revert any attendance time that an
 * approval already applied.
 */
export async function remove(id) {
  const reg = await Regularization.findByIdAndDelete(id);
  if (!reg) throw httpError(404, 'NOT_FOUND', 'Request not found');
  return { id };
}

/** Apply an approved correction to the attendance record for that day. */
async function applyToAttendance(reg) {
  const settings = await Setting.getSingleton();
  const owner = await User.findById(reg.user).select('employmentType schedule');
  const sched = effectiveSchedule(owner, settings); // part-time uses its own hours
  const day = companyDayFromYMD(reg.dateYMD);
  let record = await Attendance.findOne({ user: reg.user, date: day });
  // Checked again at approval time, not just when the request was raised: a leave can
  // be approved in between, and overwriting its ON_LEAVE marker here would leave the
  // day counted as both leave (balance still spent) and present.
  if (record?.status === 'ON_LEAVE' || (await approvedLeaveOn(reg.user, reg.dateYMD))) {
    throw httpError(409, 'ON_LEAVE', 'That day is marked on approved leave — cancel the leave first, then approve this correction.');
  }
  if (!record) record = new Attendance({ user: reg.user, date: day });

  if (reg.requestedCheckIn) {
    const inAt = companyDayInstantAt(day, reg.requestedCheckIn);
    record.checkInAt = inAt;
    record.status = isLateCheckIn(inAt, day, sched.workStart, sched.graceMinutes) ? 'LATE' : 'PRESENT';
  }
  if (reg.requestedCheckOut) {
    record.checkOutAt = companyDayInstantAt(day, reg.requestedCheckOut);
  }
  if (record.checkInAt && record.checkOutAt) {
    const { workedMinutes, overtimeMinutes } = computeWork(record.checkInAt, record.checkOutAt, day, sched.workEnd);
    record.workedMinutes = workedMinutes;
    record.overtimeMinutes = overtimeMinutes;
  }
  await record.save();
}

export async function decide(approver, id, decision, note) {
  const reg = await Regularization.findById(id).populate('user', 'name');
  if (!reg) throw httpError(404, 'NOT_FOUND', 'Request not found');
  if (reg.status !== 'PENDING') throw httpError(409, 'ALREADY_DECIDED', 'This request has already been decided');

  reg.status = decision;
  reg.decidedBy = approver._id;
  reg.decidedAt = new Date();
  reg.decisionNote = note || '';

  if (decision === 'APPROVED') await applyToAttendance(reg);
  await reg.save();

  await notify({
    user: reg.user._id,
    type: 'REGULARIZATION_DECISION',
    title: `Attendance correction ${decision === 'APPROVED' ? 'approved' : 'rejected'}`,
    message: `For ${reg.dateYMD}${note ? ` — ${note}` : ''}`,
    link: '/attendance',
  });

  return reg.toJSON();
}
