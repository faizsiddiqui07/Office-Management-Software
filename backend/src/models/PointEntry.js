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
    // The day the points were actually EARNED — the late arrival, the overtime, the day
    // the task was finished. Distinct from createdAt, which is only when the row was
    // written: a month scored after the fact would otherwise show every entry dated on
    // the day of the scan, hiding when anything really happened.
    earnedYMD: { type: String, default: '' },
    points: { type: Number, required: true }, // + credit, − penalty
    reason: { type: String, default: '' }, // human label shown in the breakdown
    source: {
      type: String,
      enum: ['auto_task', 'auto_forward', 'auto_streak', 'auto_late', 'auto_ot', 'auto_absent', 'auto_noleave', 'auto_perfect', 'manual'],
      default: 'manual',
      index: true,
    },
    taskRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null, index: true }, // idempotency for task awards
    awardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // who granted a manual award
    // What this award IS, as a stable string — 'auto_absent:<user>:<date>',
    // 'auto_noleave:<user>:<month>', 'auto_task:<task>'. Automatic awards used to be
    // kept unique by looking for an existing row and then creating one, which two
    // Lambdas running the day's first request at the same moment both passed, handing
    // the same person the same award twice. The unique index below makes the database
    // itself refuse the second one. Left unset for manual awards, which are deliberate
    // and may legitimately repeat (see the partial index).
    dedupeKey: { type: String },
  },
  { timestamps: true },
);

pointEntrySchema.index({ user: 1, month: 1 });
// Unique only for rows that HAVE a key, so any number of manual awards can coexist.
pointEntrySchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);

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
