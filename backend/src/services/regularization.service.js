import { Regularization } from '../models/Regularization.js';
import { Attendance } from '../models/Attendance.js';
import { Setting } from '../models/Setting.js';
import { User } from '../models/User.js';
import { notify, clearNotificationsFor } from '../models/Notification.js';
import { LEADERSHIP } from '../lib/permissions.js';
import { companyDayFromYMD, companyDayInstantAt, isLateCheckIn, computeWork } from '../lib/time.js';
import { effectiveSchedule } from '../lib/schedule.js';
import { onCheckOut, clearAbsencePenalty, reconcileLatePenalty, reconcilePerfectMonth } from './bonus.service.js';
import { isOffDayFor } from './attendance.service.js';

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/**
 * Is this day already fully accounted for as leave?
 *
 * The test is the ATTENDANCE ROW, not the leave's date range. A range covers weekends,
 * holidays and days the person actually came in — none of which the leave marked or
 * charged — so refusing a correction anywhere inside it blocked corrections that take
 * nothing away from anybody. What must not happen is a correction overwriting a day the
 * leave really did claim: that would leave the day counted as leave (balance spent) and
 * as present at the same time.
 *
 * So: blocked only when the day carries an untouched ON_LEAVE marker. Once there is a
 * real check-in on it — someone came in for the other half of a half-day, or worked and
 * the leave was approved afterwards (markAttendanceOnLeave deliberately preserves that)
 * — the day is theirs to correct, and the correction only fills in the missing times.
 */
/**
 * Which kind of day already owns this date — 'ON_LEAVE', 'WFH', or null if it's free.
 *
 * A work-from-home day is claimed the same way a leave day is: there are no office hours
 * to correct on it, and writing a check-in over it would erase the record. The status is
 * returned rather than a boolean so each case can keep its own error code — the leave
 * one has been ON_LEAVE since before WFH existed and callers may rely on it.
 */
async function leaveClaimsDay(userId, dateYMD) {
  const record = await Attendance.findOne({
    user: userId,
    date: companyDayFromYMD(dateYMD),
  }).select('status checkInAt');
  if (!record || record.checkInAt) return null;
  return ['ON_LEAVE', 'WFH'].includes(record.status) ? record.status : null;
}

export async function createRequest(user, { dateYMD, checkIn, checkOut, reason }) {
  if (!checkIn && !checkOut) {
    throw httpError(400, 'INVALID', 'Provide a check-in time, a check-out time, or both');
  }
  const dup = await Regularization.findOne({ user: user._id, dateYMD, status: 'PENDING' });
  if (dup) throw httpError(409, 'DUPLICATE', 'You already have a pending correction for this date');
  const claimedBy = await leaveClaimsDay(user._id, dateYMD);
  if (claimedBy === 'WFH') {
    throw httpError(409, 'WFH_DAY', 'That day is recorded as work from home — there are no office hours to correct on it.');
  }
  if (claimedBy) {
    throw httpError(409, 'ON_LEAVE', 'That day is recorded as approved leave. Ask for the leave to be cancelled first, then request the correction.');
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
        // The approver decides these on the Approvals queue.
        link: '/approvals?kind=regularizations',
        // Tag it so cancelling/deciding the correction can clear this from every
        // leader's bell — the queue link is dead once it leaves PENDING.
        entityType: 'Regularization',
        entityId: reg._id,
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
  // The row is gone — clear its "correction to review" from every leader's bell too.
  await clearNotificationsFor('Regularization', id, { types: ['REGULARIZATION'] });
  return { id };
}

/** Apply an approved correction to the attendance record for that day. */
async function applyToAttendance(reg) {
  const settings = await Setting.getSingleton();
  const owner = await User.findById(reg.user).select('employmentType schedule dateOfBirth');
  const sched = effectiveSchedule(owner, settings); // part-time uses its own hours
  const day = companyDayFromYMD(reg.dateYMD);
  // A holiday / this person's weekend / their birthday is never "late" — same rule as
  // self check-in, so a corrected time on such a day records PRESENT, not LATE.
  const offDay = await isOffDayFor(owner, reg.dateYMD, settings);
  let record = await Attendance.findOne({ user: reg.user, date: day });
  // A half-day leave day is never "late" — only the other half was owed.
  const halfLeave = !!record?.halfDayLeave;
  // Checked again at approval time, not just when the request was raised: a leave can
  // be approved in between, and overwriting an untouched ON_LEAVE marker here would
  // leave the day counted as both leave (balance still spent) and present.
  if (['ON_LEAVE', 'WFH'].includes(record?.status) && !record.checkInAt) {
    throw httpError(
      409,
      record.status === 'WFH' ? 'WFH_DAY' : 'ON_LEAVE',
      record.status === 'WFH'
        ? 'That day is marked work from home — there are no office hours to correct on it.'
        : 'That day is marked on approved leave — cancel the leave first, then approve this correction.',
    );
  }
  if (!record) record = new Attendance({ user: reg.user, date: day });

  if (reg.requestedCheckIn) {
    const inAt = companyDayInstantAt(day, reg.requestedCheckIn);
    record.checkInAt = inAt;
    record.status = !offDay && !halfLeave && isLateCheckIn(inAt, day, sched.workStart, sched.graceMinutes) ? 'LATE' : 'PRESENT';
  }
  if (reg.requestedCheckOut) {
    record.checkOutAt = companyDayInstantAt(day, reg.requestedCheckOut);
  }
  if (record.checkInAt && record.checkOutAt) {
    const { workedMinutes, overtimeMinutes } = computeWork(record.checkInAt, record.checkOutAt, day, sched.workEnd, sched.overtimeAfterMinutes);
    record.workedMinutes = workedMinutes;
    record.overtimeMinutes = overtimeMinutes;
  }
  await record.save();
  // An approved correction changes the day's overtime, so the points awarded for that
  // day have to be recomputed — otherwise the figure from the original check-out stands.
  try { await onCheckOut(owner, reg.dateYMD, record.overtimeMinutes || 0); } catch (e) { console.error('bonus hook (correction) failed', e?.message); }
  // If the day had been auto-marked absent, the correction just made it a worked day —
  // remove that stale absent penalty.
  if (record.checkInAt) {
    try { await clearAbsencePenalty(owner._id, reg.dateYMD); } catch (e) { console.error('bonus hook (correction clear absence) failed', e?.message); }
  }
  // Keep the late penalty in step with the corrected day: apply it if it's now LATE (and
  // not excused), remove it if the correction made it on-time or absent.
  // owner._id, NOT reg.user: reg.user is populated here (findById.populate), so it
  // stringifies to "{ _id: ..., name: ... }" — and these hooks build their dedupeKey from
  // it. Passed the populated object, clearAbsencePenalty and reconcileLatePenalty were
  // building garbage keys that matched nothing, so an approved correction had never
  // actually cleared the daily-scan absence penalty or reconciled the late one. owner is
  // a fresh User doc (findById above) whose _id is a real ObjectId → the right key.
  try { await reconcileLatePenalty(owner._id, reg.dateYMD, record.status === 'LATE' && !record.excused); } catch (e) { console.error('bonus hook (correction late reconcile) failed', e?.message); }
  // The perfect-attendance month award is decided ONCE at month-end and never revisited.
  // A correction to a CLOSED month (turning an absent/late day good) leaves that month
  // blemish-free, but the award was already denied — so re-run the month's verdict, the
  // same way an approved/cancelled leave now does. It recomputes from scratch, so it is
  // safe in both directions, and it self-guards on the current month (that award hasn't
  // been decided yet — the month-end rollup will read this corrected day).
  const month = reg.dateYMD.slice(0, 7);
  try { await reconcilePerfectMonth(owner._id, month); } catch (e) { console.error('bonus hook (correction perfect-month) failed', e?.message); }
}

export async function decide(approver, id, decision, note) {
  const reg = await Regularization.findById(id).populate('user', 'name');
  if (!reg) throw httpError(404, 'NOT_FOUND', 'Request not found');
  if (reg.status !== 'PENDING') throw httpError(409, 'ALREADY_DECIDED', 'This request has already been decided');
  // Same rule as leave: you don't sign off your own. A role that can both raise a
  // correction and approve one would otherwise rewrite its own attendance unchecked.
  if (String(reg.user?._id ?? reg.user) === String(approver._id)) {
    throw httpError(403, 'SELF_DECISION', 'You cannot decide your own attendance correction — someone else has to review it');
  }

  // Decided now — clear the "correction to review" from every leader's bell, including
  // the others who never acted on it.
  await clearNotificationsFor('Regularization', id, { types: ['REGULARIZATION'] });

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
