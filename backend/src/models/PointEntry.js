import mongoose from 'mongoose';

/**
 * One credit or debit of bonus points for a user, in a given month. The month is
 * stored as "YYYY-MM" so totals reset per calendar month while history is kept.
 * `points` may be negative (a penalty). `source` says how it was earned so we can
 * keep auto entries idempotent (one per task) and let leadership undo mistakes.
 */
const pointEntrySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    month: { type: String, required: true, index: true }, // 'YYYY-MM'
    points: { type: Number, required: true }, // + credit, − penalty
    reason: { type: String, default: '' }, // human label shown in the breakdown
    source: {
      type: String,
      enum: ['auto_task', 'auto_streak', 'auto_late', 'auto_ot', 'auto_absent', 'auto_noleave', 'auto_perfect', 'manual'],
      default: 'manual',
      index: true,
    },
    taskRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null, index: true }, // idempotency for task awards
    awardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // who granted a manual award
  },
  { timestamps: true },
);

pointEntrySchema.index({ user: 1, month: 1 });

pointEntrySchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const PointEntry = mongoose.models.PointEntry || mongoose.model('PointEntry', pointEntrySchema);
