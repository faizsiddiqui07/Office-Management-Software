import { hashPassword } from '../lib/password.js';
import { generateEmployeeId } from '../lib/employeeId.js';
import { generateTempPassword } from '../lib/tempPassword.js';
import { User } from '../models/User.js';
import { LeaveBalance } from '../models/LeaveBalance.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { Attendance } from '../models/Attendance.js';
import { Regularization } from '../models/Regularization.js';
import { Task } from '../models/Task.js';
import { Notification } from '../models/Notification.js';
import { PushSubscription } from '../models/PushSubscription.js';
import { PasswordResetToken } from '../models/PasswordResetToken.js';
import { AnnouncementRead } from '../models/AnnouncementRead.js';
import { LedgerEntry } from '../models/LedgerEntry.js';
import { Setting } from '../models/Setting.js';
import { canAssignRole } from '../lib/permissions.js';

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/** Any user may have a custom schedule; empty fields mean "follow office hours/week". */
function normalizeSchedule(_employmentType, schedule) {
  if (!schedule) return { workStart: '', workEnd: '', graceMinutes: 0, workDays: [] };
  // De-dupe + sort the working-day numbers (0=Sun…6=Sat); [] = follow office weekends.
  const workDays = Array.isArray(schedule.workDays)
    ? [...new Set(schedule.workDays.map(Number).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  return {
    workStart: schedule.workStart || '',
    workEnd: schedule.workEnd || '',
    graceMinutes: Number(schedule.graceMinutes) || 0,
    workDays,
  };
}

/**
 * Creates a new employee: unique employeeId, hashed temp password,
 * mustChangePassword=true, and a LeaveBalance for the current year.
 * Returns the user doc + the plaintext temp password (shown once).
 */
export async function createEmployee({
  name,
  email,
  role,
  department = '',
  designation = '',
  phone = '',
  reportsTo = null,
  employmentType = 'FULL_TIME',
  schedule = null,
  temporaryPassword,
  createdBy = null,
}) {
  const normalizedEmail = email.toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) throw httpError(409, 'EMAIL_TAKEN', 'A user with that email already exists');

  const employeeId = await generateEmployeeId();
  const tempPassword = temporaryPassword || generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const user = await User.create({
    name,
    email: normalizedEmail,
    employeeId,
    passwordHash,
    role,
    employmentType: employmentType === 'PART_TIME' ? 'PART_TIME' : 'FULL_TIME',
    schedule: normalizeSchedule(employmentType, schedule),
    department,
    designation,
    phone,
    reportsTo: reportsTo || null,
    createdBy: createdBy || null,
    mustChangePassword: true,
    isActive: true,
  });

  const settings = await Setting.getSingleton();
  const year = new Date().getFullYear();
  await LeaveBalance.findOneAndUpdate(
    { user: user._id, year },
    {
      $setOnInsert: {
        user: user._id,
        year,
        totalQuota: settings.annualLeaveQuota,
        used: 0,
        remaining: settings.annualLeaveQuota,
        overtimeMinutes: 0,
      },
    },
    { upsert: true, new: true },
  );

  return { user, tempPassword };
}

/** Regenerates a strong temp password and forces a change on next login. */
export async function resetUserCredentials(userId) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');

  const tempPassword = generateTempPassword();
  user.passwordHash = await hashPassword(tempPassword);
  user.mustChangePassword = true;
  await user.save();

  return { user, tempPassword };
}

/**
 * Leadership-only profile / role / status update.
 * Guards: can't change your own role, can't deactivate yourself, and you may
 * only assign a role at your own tier or below it (rank-based, via canAssignRole).
 */
export async function updateUser(actor, id, data) {
  const user = await User.findById(id);
  if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');
  const isSelf = String(actor._id) === String(id);

  if (data.role !== undefined && data.role !== user.role) {
    if (isSelf) throw httpError(403, 'FORBIDDEN', 'You cannot change your own role');
    if (!canAssignRole(actor.role, data.role)) {
      throw httpError(403, 'FORBIDDEN', 'You cannot assign that role');
    }
    user.role = data.role;
  }

  if (data.isActive !== undefined) {
    if (isSelf && data.isActive === false) {
      throw httpError(403, 'FORBIDDEN', 'You cannot deactivate your own account');
    }
    user.isActive = data.isActive;
  }

  for (const f of ['name', 'department', 'designation', 'phone']) {
    if (data[f] !== undefined) user[f] = data[f];
  }
  if (data.reportsTo !== undefined) user.reportsTo = data.reportsTo || null;

  if (data.taskAssign !== undefined) {
    const mode = ['NONE', 'ALL', 'SELECTED'].includes(data.taskAssign.mode) ? data.taskAssign.mode : 'NONE';
    let targets = [];
    if (mode === 'SELECTED') {
      // Keep only real, other users (drops self / typos / deleted accounts).
      const ids = (data.taskAssign.users || []).filter((x) => String(x) !== String(id));
      const found = await User.find({ _id: { $in: ids } }).select('_id');
      targets = found.map((u) => u._id);
    }
    user.taskAssign = { mode, users: targets };
  }

  if (data.employmentType !== undefined) {
    user.employmentType = data.employmentType === 'PART_TIME' ? 'PART_TIME' : 'FULL_TIME';
  }
  if (data.employmentType !== undefined || data.schedule !== undefined) {
    // Re-normalize so switching to full-time clears any old custom hours.
    user.schedule = normalizeSchedule(user.employmentType, data.schedule ?? user.schedule);
  }

  await user.save();
  return user.toJSON();
}

/**
 * Permanently delete a DEACTIVATED user and their personal data. Guarded: you
 * can't delete yourself, and the user must already be inactive (deactivate
 * first). Their transactional records are removed; references pointing at them
 * (delegated tasks, decisions, reportsTo, etc.) are detached so nothing breaks;
 * authored content + the audit trail are kept (with an orphaned link).
 */
export async function deleteUser(actor, id) {
  if (String(actor._id) === String(id)) {
    throw httpError(403, 'FORBIDDEN', 'You cannot delete your own account');
  }
  const user = await User.findById(id);
  if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');
  if (user.isActive) {
    throw httpError(409, 'STILL_ACTIVE', 'Deactivate the user first, then delete');
  }

  const uid = user._id;

  // Remove their own transactional data.
  await Promise.all([
    Attendance.deleteMany({ user: uid }),
    LeaveRequest.deleteMany({ user: uid }),
    LeaveBalance.deleteMany({ user: uid }),
    Regularization.deleteMany({ user: uid }),
    Task.deleteMany({ owner: uid }),
    Notification.deleteMany({ user: uid }),
    PushSubscription.deleteMany({ user: uid }),
    PasswordResetToken.deleteMany({ user: uid }),
    AnnouncementRead.deleteMany({ user: uid }),
    LedgerEntry.deleteMany({ person: uid }),
  ]);

  // Detach references pointing AT them so other records stay valid.
  await Promise.all([
    Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null } }),
    LeaveRequest.updateMany({ decidedBy: uid }, { $set: { decidedBy: null } }),
    Regularization.updateMany({ decidedBy: uid }, { $set: { decidedBy: null } }),
    Attendance.updateMany({ excusedBy: uid }, { $set: { excusedBy: null } }),
    User.updateMany({ reportsTo: uid }, { $set: { reportsTo: null } }),
    User.updateMany({ createdBy: uid }, { $set: { createdBy: null } }),
    User.updateMany({ 'taskAssign.users': uid }, { $pull: { 'taskAssign.users': uid } }),
  ]);

  await user.deleteOne();
  return { success: true };
}
