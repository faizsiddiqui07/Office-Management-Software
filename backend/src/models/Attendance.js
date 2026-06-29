import mongoose from 'mongoose';

const metaSchema = new mongoose.Schema(
  { ip: String, userAgent: String, lat: Number, lng: Number, distance: Number },
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
      enum: ['PRESENT', 'LATE', 'ABSENT', 'ON_LEAVE', 'HOLIDAY'],
      default: 'ABSENT',
    },
    workedMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    checkInMeta: { type: metaSchema, default: undefined },
    checkOutMeta: { type: metaSchema, default: undefined },
  },
  { timestamps: true },
);

attendanceSchema.index({ user: 1, date: 1 }, { unique: true });
attendanceSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Attendance =
  mongoose.models.Attendance || mongoose.model('Attendance', attendanceSchema);
