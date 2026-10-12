import mongoose from 'mongoose';

const metaSchema = new mongoose.Schema(
  {
    ip: String,
    userAgent: String,
    lat: Number,
    lng: Number,
    distance: Number,
    // Site par kaam karne walon ke liye "selfie se attendance" — S3 ka key
    // (attendance/YYYY/MM/<random>.jpg). Photo khud S3 me rehti hai, yahan sirf uska pata.
    //
    // ISKA HONA HI NISHAAN HAI ki ye check-in/out selfie se laga tha. Alag se koi
    // `viaSelfie` flag jaan-bujh kar NAHI rakha — do jagah ek hi sach rakhne se wo ek din
    // aapas me alag ho jaate hain. Table isi se badge dikhati hai, aur owner ka niyam
    // yahi hai ki selfie wala check-in saaf dikhna chahiye (us par late nahi lagti, to
    // nazar bani rehni chahiye).
    selfieKey: String,
    // Phone ne location kitni pakki batai (meter me). Kharab reading (jaise 500 m) baad me
    // pehchani ja sake, isliye jo mila wahi likh rahe hain — iss par abhi koi rok nahi.
    accuracy: Number,
  },
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
    // Ye din is bande ke liye CHHUTTI ka tha (company holiday / uska weekly off / uska
    // janamdin) aur phir bhi usne kaam kiya. Aise din ka poora waqt overtime ginta hai —
    // check-in se check-out tak (owner ka niyam, 1 Oct 2026 se; lib/time.js ka
    // OFFDAY_FULL_OT_FLOOR_YMD).
    //
    // YE CALENDAR SE HAR BAAR DOBARA KYUN NAHI NIKALA JAATA (owner ka faisla, 12 Oct 2026):
    // overtime ka hisaab khud-ba-khud dobara chalta hai — Settings me shift end badlo, ya
    // kisi ka schedule edit karo, aur uska POORA itihaas dobara gina jaata hai (koi date
    // seema nahi). Agar har baar aaj ke calendar se poochha jaata, to teen mahine baad
    // kisi ka weekly off badalne par uska guzra hua October chupchaap kam ho jaata. Yahan
    // nishaan lag jaane se wo din patthar par likha rehta hai.
    //
    // Nishaan sirf "wo din chhutti ka tha" ka hai — MINUTE ka nahi. Check-out ka waqt
    // sudhre to overtime badalna hi chahiye; par 11 October Sunday THA, ye baat kabhi
    // nahi badalni chahiye.
    //
    // Lagta hai: check-in, leadership ki attendance edit, aur correction approve hone par.
    // Holiday calendar badalne par wo raasta un dinon ka nishaan dobara lagata hai.
    offDayWork: { type: Boolean, default: false },
    // ON_LEAVE for half the day only — the leave that produced it was a half-day, and
    // the balance was charged 0.5. Without this the sheet reported a whole day away
    // against a half-day deduction.
    halfDayLeave: { type: Boolean, default: false },
    // Which half the half-day leave covers — 'FIRST' (morning off, worked the afternoon)
    // or 'SECOND' (worked the morning, afternoon off). Mirrors the LeaveRequest so the
    // sheet can show the two halves in the right order. null when it's not a half-day.
    halfDayPart: { type: String, enum: ['FIRST', 'SECOND', null], default: null },
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
