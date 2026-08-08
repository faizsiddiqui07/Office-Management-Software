import mongoose from 'mongoose';
import { roleLabel } from '../lib/roles.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    employeeId: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, required: true, default: 'EMPLOYEE', index: true },
    // Full-time follows the office hours; part-time uses its own `schedule` below.
    employmentType: { type: String, enum: ['FULL_TIME', 'PART_TIME'], default: 'FULL_TIME' },
    // Per-user work window — only used when employmentType === 'PART_TIME'.
    schedule: {
      workStart: { type: String, default: '' }, // 'HH:mm' company time
      workEnd: { type: String, default: '' }, // 'HH:mm'
      graceMinutes: { type: Number, default: 0 },
      // Overtime starts this many minutes past THIS person's end time. null = follow the
      // office-wide overtimeAfterMinutes; a number (incl. 0) overrides it for this person.
      overtimeAfterMinutes: { type: Number, default: null },
      // Day-of-week numbers (0=Sun…6=Sat) a part-timer works. Empty = follow the
      // company weekend config; non-empty = works ONLY these days.
      workDays: { type: [Number], default: [] },
    },
    // Task delegation access — set per person by leadership (Users → Edit).
    // NONE: can't assign work. ALL: can assign to anyone. SELECTED: only to `users`.
    taskAssign: {
      mode: { type: String, enum: ['NONE', 'ALL', 'SELECTED'], default: 'NONE' },
      users: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
    },
    department: { type: String, default: '' },
    designation: { type: String, default: '' },
    phone: { type: String, default: '' },
    // Date of birth (YYYY-MM-DD, company TZ). Kept in two-way sync with the person's
    // BIRTHDAY entry on the calendar: set it here (profile) and the calendar entry
    // follows; the CEO sets it from the calendar and this follows. Its month-day is what
    // exempts a birthday from the late-arrival penalty. Blank = not recorded.
    dateOfBirth: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    dateOfJoining: { type: Date, default: Date.now },
    // Offboarding: the person's last working day (YYYY-MM-DD, company TZ). Set when winding
    // an account down; the exit summary is reviewed before deactivating. Blank = not leaving.
    lastWorkingYMD: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: true },
    // When this account's password last changed. Sessions are signed for ~10 years, so
    // without this a password change (or a leadership credential reset for someone who
    // has left) rotated the hash while every token already on their phone kept working.
    // requireAuth rejects any token issued before this moment. Null on existing accounts
    // — nobody is signed out retroactively; it starts mattering at the next change.
    credentialsChangedAt: { type: Date, default: null },
    reportsTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Never leak the password hash; expose `id` instead of `_id`.
userSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.passwordHash;
    // The role's editable display name travels with every user, so the UI shows
    // the current label (e.g. "Nucleus Team") everywhere — not the fixed key.
    ret.roleLabel = roleLabel(ret.role);
    return ret;
  },
});

export const User = mongoose.models.User || mongoose.model('User', userSchema);
