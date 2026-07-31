import mongoose from 'mongoose';

const leaveRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // WFH is not leave — the person WORKS that day, so no balance is deducted. It rides
    // on this model so it flows through the same apply / edit / approve / cancel
    // machinery and shows up wherever leave does. Its own rules (one day at a time, a
    // yearly cap) live in leave.service.js.
    // Only CASUAL, SICK and WFH can be created now — PAID and UNPAID were retired as
    // choices (see website/lib/leave.js). They stay in the enum so any request stored
    // before the change still validates on save (cancel/approve/edit) and reads correctly.
    type: { type: String, enum: ['CASUAL', 'SICK', 'PAID', 'UNPAID', 'WFH'], required: true },
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
