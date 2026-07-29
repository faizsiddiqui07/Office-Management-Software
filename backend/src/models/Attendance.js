import mongoose from 'mongoose';

const metaSchema = new mongoose.Schema(
  { ip: String, userAgent: String, lat: Number, lng: Number, distance: Number },
  { _id: false },
);

// Why a check-in was late (e.g. a morning site visit). Optional.
const lateReasonSchema = new mongoose.Schema(
  { category: { type: String, default: '' }, note: { type: String, default: '' } },
  { _id: false },
);

const attendanceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Company-TZ midnight (UTC instant) — the canonical "day".
    date: { type: Date, required: true },
    checkInAt: { type: Date, default: null },
    checkOutAt: { type: Date, default: null },
    status: {
      type: String,
      // WFH: an approved work-from-home day. The person WORKED, so it counts as attended
      // everywhere a rate is calculated — it is simply recorded distinctly, and carries
      // no check-in/check-out because there is nothing to clock.
      enum: ['PRESENT', 'LATE', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WFH'],
      default: 'ABSENT',
    },
    workedMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    // ON_LEAVE for half the day only — the leave that produced it was a half-day, and
    // the balance was charged 0.5. Without this the sheet reported a whole day away
    // against a half-day deduction.
    halfDayLeave: { type: Boolean, default: false },
    // This WFH day was DECLARED BY THE OFFICE for everyone, not requested by the person.
    // It is what lets the declaration be undone again, and what keeps an office day out
    // of anybody's personal yearly WFH allowance (which is counted from their requests,
    // never from these rows).
    wfhOfficeWide: { type: Boolean, default: false },
    checkInMeta: { type: metaSchema, default: undefined },
    checkOutMeta: { type: metaSchema, default: undefined },
    // Late check-in: optional reason + leadership "excuse" (so on-duty lates
    // aren't counted against the person).
    lateReason: { type: lateReasonSchema, default: undefined },
    excused: { type: Boolean, default: false },
    excusedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    excusedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

attendanceSchema.index({ user: 1, date: 1 }, { unique: true });
// A compound index starting with `user` can't answer a query that filters by date
// alone, and plenty of hot paths do exactly that: the daily roster (every dashboard
// load), the overtime leaderboard, the payroll matrix, the company report. Those were
// scanning the whole collection, which grows by roughly a row per person per day.
attendanceSchema.index({ date: 1 });
attendanceSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Attendance =
  mongoose.models.Attendance || mongoose.model('Attendance', attendanceSchema);
