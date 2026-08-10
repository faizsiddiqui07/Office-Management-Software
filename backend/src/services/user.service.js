import { hashPassword } from '../lib/password.js';
import { companyDayFromYMD, ymdInTz } from '../lib/time.js';
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
import { PointEntry } from '../models/PointEntry.js';
import { Setting } from '../models/Setting.js';
import { recomputeAllOvertime } from './attendance.service.js';
import { can, canAssignRole } from '../lib/permissions.js';
import { isOwnerRole } from '../lib/roles.js';
import { canAssignAny } from './task.service.js';
import { clearFailures } from '../lib/loginGuard.js';
import { leaveYearOf } from '../lib/leaveYear.js';
import { quotaForJoiner } from './leave.service.js';
import { ledgerFor } from './dues.service.js';

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/** Any user may have a custom schedule; empty fields mean "follow office hours/week". */
function normalizeSchedule(_employmentType, schedule) {
  if (!schedule) return { workStart: '', workEnd: '', graceMinutes: 0, workDays: [], overtimeAfterMinutes: null };
  // De-dupe + sort the working-day numbers (0=Sun…6=Sat); [] = follow office weekends.
  const workDays = Array.isArray(schedule.workDays)
    ? [...new Set(schedule.workDays.map(Number).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  // Blank ('' / null / not a number) = follow the office overtime buffer; a number pins it.
  const otRaw = schedule.overtimeAfterMinutes;
  const overtimeAfterMinutes = otRaw === '' || otRaw === null || otRaw === undefined || !Number.isFinite(Number(otRaw))
    ? null
    : Math.max(0, Math.min(600, Math.round(Number(otRaw))));
  return {
    workStart: schedule.workStart || '',
    workEnd: schedule.workEnd || '',
    graceMinutes: Number(schedule.graceMinutes) || 0,
    workDays,
    overtimeAfterMinutes,
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

  // Seed this year's leave balance. Two things matter here: the leave year runs
  // April–March (the calendar year would file a January joiner under the wrong one,
  // hiding their real balance), and someone joining part-way through only earns the
  // months they're here for — the same rule getOrCreateBalance applies.
  const settings = await Setting.getSingleton();
  const joinedOn = ymdInTz(user.dateOfJoining || new Date());
  // The balance belongs to the leave year we are IN, not the one the person joined in.
  // Deriving it from the joining date filed anyone hired before this April under a past
  // year, so the account came out with no balance for the year everything else reads.
  const year = leaveYearOf(ymdInTz(new Date()));
  const quota = quotaForJoiner(joinedOn, year, settings.annualLeaveQuota);
  await LeaveBalance.findOneAndUpdate(
    { user: user._id, year },
    {
      $setOnInsert: {
        user: user._id,
        year,
        totalQuota: quota,
        used: 0,
        remaining: quota,
        overtimeMinutes: 0,
      },
    },
    { upsert: true, new: true },
  );

  return { user, tempPassword };
}

/**
 * Regenerates a strong temp password and forces a change on next login.
 *
 * Rank-guarded: an actor may only reset the credentials of someone at their own
 * tier or BELOW (rank-based, via canAssignRole). Without this, ANY resetCredentials
 * holder — including a junior custom role granted the permission — could reset the
 * CEO's password (the fresh temp is shown on screen) and take over the account.
 */
export async function resetUserCredentials(actor, userId) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');
  if (!canAssignRole(actor.role, user.role)) {
    throw httpError(403, 'FORBIDDEN', 'You cannot reset the credentials of a user senior to you');
  }

  const tempPassword = generateTempPassword();
  user.passwordHash = await hashPassword(tempPassword);
  user.mustChangePassword = true;
  // Cuts off every device this person is still signed in on. This is the point of a
  // reset for someone who has left — before, their phone kept working for years
  // because the token, not the password, is what the API trusts.
  user.credentialsChangedAt = new Date();
  await user.save();

  // Their phone would otherwise keep receiving push notifications — task assignments,
  // announcements, dues — because a subscription is tied to the device, not the
  // session. Cutting the session has to cut these too. Also clears any sign-in lockout,
  // so the new temporary password works immediately.
  await Promise.all([
    PushSubscription.deleteMany({ user: user._id }),
    clearFailures(user.email),
  ]);

  return { user, tempPassword };
}

// Profile fields (anything that isn't role or active-status). Editing any of these
// is what the base "Edit users" (manageUsers) permission covers.
const PROFILE_FIELDS = ['name', 'department', 'designation', 'phone', 'reportsTo', 'dateOfJoining', 'lastWorkingYMD', 'taskAssign', 'employmentType', 'schedule'];

/**
 * Profile / role / status update, gated per-change so the granular permissions
 * actually mean something:
 *   - changing a ROLE needs `changeRoles`;
 *   - activating / deactivating needs `deactivateUsers`;
 *   - any other profile edit needs `manageUsers` ("Edit users").
 * On top of that, a RANK guard applies to every path: you may only act on a user
 * at your own tier or below — never a senior (rank-based, via canAssignRole). This
 * stops a junior manageUsers holder from demoting, disabling or editing the CEO.
 * You still can't change your own role or deactivate yourself.
 */
export async function updateUser(actor, id, data) {
  const user = await User.findById(id);
  if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');
  const isSelf = String(actor._id) === String(id);
  // Whether the actor outranks (or ties) the TARGET as they are right now.
  const canActOnTarget = canAssignRole(actor.role, user.role);

  if (data.role !== undefined && data.role !== user.role) {
    if (isSelf) throw httpError(403, 'FORBIDDEN', 'You cannot change your own role');
    if (!can(actor, 'changeRoles')) throw httpError(403, 'FORBIDDEN', 'You do not have permission to change roles');
    if (!canActOnTarget) throw httpError(403, 'FORBIDDEN', 'You cannot change the role of a user senior to you');
    if (!canAssignRole(actor.role, data.role)) {
      throw httpError(403, 'FORBIDDEN', 'You cannot assign that role');
    }
    user.role = data.role;
  }

  if (data.isActive !== undefined && data.isActive !== user.isActive) {
    if (isSelf && data.isActive === false) {
      throw httpError(403, 'FORBIDDEN', 'You cannot deactivate your own account');
    }
    if (!can(actor, 'deactivateUsers')) throw httpError(403, 'FORBIDDEN', 'You do not have permission to activate or deactivate users');
    if (!canActOnTarget) throw httpError(403, 'FORBIDDEN', 'You cannot change the status of a user senior to you');
    user.isActive = data.isActive;
  }

  // Any remaining profile change needs base edit rights + rank authority.
  if (PROFILE_FIELDS.some((f) => data[f] !== undefined)) {
    if (!can(actor, 'manageUsers')) throw httpError(403, 'FORBIDDEN', 'You do not have permission to edit users');
    if (!canActOnTarget) throw httpError(403, 'FORBIDDEN', 'You cannot edit a user senior to you');
  }

  for (const f of ['name', 'department', 'designation', 'phone']) {
    if (data[f] !== undefined) user[f] = data[f];
  }
  if (data.reportsTo !== undefined) user.reportsTo = data.reportsTo || null;
  if (data.lastWorkingYMD !== undefined) user.lastWorkingYMD = data.lastWorkingYMD || '';

  // The joining date decides which periods this person appears in at all, so it has to
  // be correctable — an account created late for someone who started earlier would
  // otherwise hide their real history for good.
  if (data.dateOfJoining !== undefined) {
    const wasYMD = ymdInTz(user.dateOfJoining || new Date());
    user.dateOfJoining = companyDayFromYMD(data.dateOfJoining);
    const nowYMD = ymdInTz(user.dateOfJoining);
    // Correcting the date should correct the leave it earns, otherwise an account
    // created late leaves the person short for the rest of the year. Only touch a
    // quota that still matches what the old date produced — a figure leadership set by
    // hand is a deliberate exception and must survive. `used` is never recalculated.
    if (nowYMD !== wasYMD) {
      const settings = await Setting.getSingleton();
      // Again the CURRENT leave year. Using the corrected joining date's year meant
      // that setting someone's real start date of 2022 went looking for a 2022 balance,
      // found nothing, and silently left them on the part-year quota they had been
      // given while the app still thought they joined this July.
      const year = leaveYearOf(ymdInTz(new Date()));
      const bal = await LeaveBalance.findOne({ user: user._id, year });
      if (bal) {
        const wasExpected = quotaForJoiner(wasYMD, year, settings.annualLeaveQuota);
        const nowExpected = quotaForJoiner(nowYMD, year, settings.annualLeaveQuota);
        if (bal.totalQuota === wasExpected && nowExpected !== wasExpected) {
          bal.totalQuota = nowExpected;
          bal.remaining = nowExpected - bal.used;
          await bal.save();
        }
      }
    }
  }

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
  const scheduleTouched = data.employmentType !== undefined || data.schedule !== undefined;
  if (scheduleTouched) {
    // Re-normalize so switching to full-time clears any old custom hours.
    user.schedule = normalizeSchedule(user.employmentType, data.schedule ?? user.schedule);
  }

  await user.save();
  // A changed shift end or overtime buffer changes this person's stored overtime, so
  // re-derive it (and their bonus overtime points) — every report reads the stored value.
  if (scheduleTouched) {
    try { await recomputeAllOvertime({ userId: user._id }); } catch (e) { console.error('overtime recompute after user edit failed', e?.message); }
  }
  return user.toJSON();
}

/**
 * The open items to clear before someone is offboarded — so nothing is silently
 * orphaned when their account goes inactive. Read-only; blocks nothing (the numbers are
 * shown as a checklist next to the deactivate switch). The dues balance is real money
 * (the admin manager fronts cash), and open delegated work needs reassigning.
 */
export async function exitSummary(userId) {
  const user = await User.findById(userId).select('name');
  if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');
  const month = ymdInTz(new Date()).slice(0, 7);

  const [openTasksOwned, openTasksDelegated, pendingLeaves, dues, pts] = await Promise.all([
    Task.countDocuments({ owner: userId, status: 'PENDING' }),
    // Work they handed to OTHERS that's still open — the assigner is leaving, so it may
    // need re-homing. Excludes their own copies (counted above).
    Task.countDocuments({ assignedBy: userId, status: 'PENDING', owner: { $ne: userId } }),
    LeaveRequest.countDocuments({ user: userId, status: 'PENDING' }),
    ledgerFor(userId), // { pending, advance }
    PointEntry.find({ user: userId, month }).select('points'),
  ]);

  return {
    openTasksOwned,
    openTasksDelegated,
    pendingLeaves,
    duesPending: dues.pending,
    duesAdvance: dues.advance,
    pointsThisMonth: pts.reduce((s, p) => s + p.points, 0),
  };
}

/**
 * Permanently delete a DEACTIVATED user and their personal data. Guarded: you
 * can't delete yourself, and the user must already be inactive (deactivate
 * first). Their transactional records are removed; references pointing at them
 * (delegated tasks, decisions, reportsTo, etc.) are detached so nothing breaks;
 * authored content + the audit trail are kept (with an orphaned link).
 *
 * `reassignTasksTo` names who becomes responsible for the work this person had DELEGATED
 * and that is still open. Without it those tasks are left with nobody against them: no
 * one to chase, approve or close them, and — since the assigner check is what stops an
 * assignee editing their own deadline — no one able to touch them at all.
 *
 * It writes `handedOverTo`, NOT `assignedBy`. Moving `assignedBy` would re-point the
 * whole points system at somebody who was not there when the points were earned: a
 * non-owner successor makes the task fail the owner-tier gate and its entries are deleted
 * on completion, while an owner-tier one drags a task that never scored INTO the system
 * and back-files penalties into months that are already closed. The points side stays
 * frozen exactly as it is; only responsibility moves.
 */
export async function deleteUser(actor, id, { reassignTasksTo } = {}) {
  if (String(actor._id) === String(id)) {
    throw httpError(403, 'FORBIDDEN', 'You cannot delete your own account');
  }
  const user = await User.findById(id);
  if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');
  // Rank guard: you may only delete a user at your own tier or below — never a
  // senior. Deletion wipes their attendance/leave/tasks/dues, so a junior must not
  // be able to erase someone above them.
  if (!canAssignRole(actor.role, user.role)) {
    throw httpError(403, 'FORBIDDEN', 'You cannot delete a user senior to you');
  }
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

  // ── Hand the still-open delegated work over ───────────────────────────────
  // Runs before anything is detached, while the links are still intact.
  let handedOver = 0;
  let handedOverTo = '';
  if (reassignTasksTo) {
    if (!/^[a-f\d]{24}$/i.test(String(reassignTasksTo))) {
      throw httpError(400, 'INVALID', 'Pick a valid person to take the open tasks over');
    }
    if (String(reassignTasksTo) === String(uid)) {
      throw httpError(400, 'INVALID', 'Pick somebody other than the person being removed');
    }
    const heir = await User.findById(reassignTasksTo).select('name isActive taskAssign');
    if (!heir || !heir.isActive) {
      throw httpError(400, 'INVALID', 'The person taking the tasks over must be an active user');
    }
    // They have to be able to delegate at all, or the handover is decorative — the task
    // would name somebody who still cannot reassign it.
    if (!canAssignAny(heir)) {
      throw httpError(400, 'INVALID', `${heir.name} isn’t set up to assign work — pick someone who is`);
    }
    // Only work that is still OPEN and belongs to somebody ELSE. A finished task needs no
    // chasing, and their own copies are deleted with them a few lines below. Tasks the
    // heir already owns are skipped too: naming them responsible for their own work would
    // let them approve their own submission.
    const res = await Task.updateMany(
      { assignedBy: uid, status: 'PENDING', owner: { $nin: [uid, heir._id] } },
      { $set: { handedOverTo: heir._id } },
    );
    handedOver = res.modifiedCount ?? 0;
    handedOverTo = heir.name;
  }

  // A delegated task earns points only because somebody in the owner tier can see it —
  // and being TAGGED on it is one of the two ways that happens. Removing an owner-tier
  // account therefore takes the evidence away from every task they were tagged on, even
  // ones they never assigned, and the nightly pass would then read those points as
  // ineligible and delete them from whoever earned them. Freeze the decision first,
  // while the tag is still there to be seen.
  // Scoped to DELEGATED tasks on purpose: a personal task shared with collaborators must
  // keep them as co-owners, and the same flag is what task.service reads to decide that.
  if (isOwnerRole(user.role)) {
    await Task.updateMany(
      { collaborators: uid, assignedBy: { $ne: null } },
      { $set: { pointsGateFrozen: true } },
    );
  }

  // Detach references pointing AT them so other records stay valid.
  await Promise.all([
    // Clearing `assignedBy` keeps the task valid, but on its own it also erases the fact
    // that the task was ever delegated — and the points on it belong to the ASSIGNEE, not
    // to the account being removed. The marker is what lets the rewards pass tell
    // "delegated, assigner gone" apart from "never delegated".
    Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, pointsGateFrozen: true } }),
    // Their tag itself goes, so the task doesn't carry a member who no longer exists.
    // Runs after the freeze above — the freeze needs the tag to still be findable.
    Task.updateMany({ collaborators: uid }, { $pull: { collaborators: uid } }),
    LeaveRequest.updateMany({ decidedBy: uid }, { $set: { decidedBy: null } }),
    Regularization.updateMany({ decidedBy: uid }, { $set: { decidedBy: null } }),
    Attendance.updateMany({ excusedBy: uid }, { $set: { excusedBy: null } }),
    User.updateMany({ reportsTo: uid }, { $set: { reportsTo: null } }),
    User.updateMany({ createdBy: uid }, { $set: { createdBy: null } }),
    User.updateMany({ 'taskAssign.users': uid }, { $pull: { 'taskAssign.users': uid } }),
  ]);

  await user.deleteOne();
  return { success: true, handedOver, handedOverTo };
}
