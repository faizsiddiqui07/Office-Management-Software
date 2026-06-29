import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    year: { type: Number, required: true },
    totalQuota: { type: Number, required: true, default: 18 },
    used: { type: Number, default: 0 },
    remaining: { type: Number, default: 18 },
    overtimeMinutes: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schema.index({ user: 1, year: 1 }, { unique: true });
schema.set('toJSON', { virtuals: true, versionKey: false });

export const LeaveBalance = mongoose.models.LeaveBalance || mongoose.model('LeaveBalance', schema);
