import mongoose from 'mongoose';

/**
 * An employee's request to correct their attendance for a past day (forgot to
 * check in/out, wrong time). Approved by leadership → applied to the record.
 */
const regularizationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    dateYMD: { type: String, required: true },
    date: { type: Date, required: true },
    requestedCheckIn: { type: String, default: null }, // 'HH:mm' (company time)
    requestedCheckOut: { type: String, default: null }, // 'HH:mm'
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '' },
  },
  { timestamps: true },
);

regularizationSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Regularization =
  mongoose.models.Regularization || mongoose.model('Regularization', regularizationSchema);
