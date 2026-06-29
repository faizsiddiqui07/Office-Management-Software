import mongoose from 'mongoose';

const leaveRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['CASUAL', 'SICK', 'PAID', 'UNPAID'], required: true },
    // Company-TZ midnight instants + their yyyy-MM-dd strings (for enumeration/display).
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    startYMD: { type: String, required: true },
    endYMD: { type: String, required: true },
    halfDay: { type: Boolean, default: false },
    halfDayPart: { type: String, enum: ['FIRST', 'SECOND', null], default: null },
    workingDays: { type: Number, default: 0 }, // days actually consumed
    reason: { type: String, default: '' },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '' },
    appliedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

leaveRequestSchema.set('toJSON', { virtuals: true, versionKey: false });

export const LeaveRequest =
  mongoose.models.LeaveRequest || mongoose.model('LeaveRequest', leaveRequestSchema);
