import { Regularization } from '../models/Regularization.js';
import { Attendance } from '../models/Attendance.js';
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

export async function createRequest(user, { dateYMD, checkIn, checkOut, reason }) {
  if (!checkIn && !checkOut) {
    throw httpError(400, 'INVALID', 'Provide a check-in time, a check-out time, or both');
  }
  const dup = await Regularization.findOne({ user: user._id, dateYMD, status: 'PENDING' });
  if (dup) throw httpError(409, 'DUPLICATE', 'You already have a pending correction for this date');

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
