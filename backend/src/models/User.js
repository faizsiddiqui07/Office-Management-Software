import mongoose from 'mongoose';

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
    },
    department: { type: String, default: '' },
    designation: { type: String, default: '' },
    phone: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    dateOfJoining: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: true },
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
    return ret;
  },
});

export const User = mongoose.models.User || mongoose.model('User', userSchema);
