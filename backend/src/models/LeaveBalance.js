import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    year: { type: Number, required: true },
    totalQuota: { type: Number, required: true, default: 18 },
    used: { type: Number, default: 0 },
    remaining: { type: Number, default: 18 },
    // DEPRECATED — nothing writes this any more and nothing should read it. Overtime
    // is summed from the attendance days (leave.service.js overtimeMinutesForYear), so
    // it can't drift from them the way this running total did. Kept only so existing
    // documents stay valid.
    overtimeMinutes: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schema.index({ user: 1, year: 1 }, { unique: true });
schema.set('toJSON', { virtuals: true, versionKey: false });

export const LeaveBalance = mongoose.models.LeaveBalance || mongoose.model('LeaveBalance', schema);
