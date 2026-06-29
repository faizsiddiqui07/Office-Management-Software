import { hashPassword } from '../lib/password.js';
import { generateEmployeeId } from '../lib/employeeId.js';
import { generateTempPassword } from '../lib/tempPassword.js';
import { User } from '../models/User.js';
import { LeaveBalance } from '../models/LeaveBalance.js';
import { Setting } from '../models/Setting.js';
import { canAssignRole } from '../lib/permissions.js';

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
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
 * Guards: can't change your own role, can't deactivate yourself, and only
 * CEO/BOSS may assign CEO/BOSS (via canAssignRole).
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

  await user.save();
  return user.toJSON();
}
