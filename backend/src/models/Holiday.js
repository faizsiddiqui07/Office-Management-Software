import mongoose from 'mongoose';

const holidaySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: ['HOLIDAY', 'EVENT', 'OPTIONAL_HOLIDAY', 'BIRTHDAY'], default: 'HOLIDAY', index: true },
    // Company-TZ midnight instants + yyyy-MM-dd strings (supports single or multi-day).
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    startYMD: { type: String, required: true, index: true },
    endYMD: { type: String, required: true },
    description: { type: String, default: '' },
    // Comes back on the same date every year — 15 August, a birthday. NOT automatic by
    // type: Diwali, Eid and Holi are HOLIDAY rows too and land on a different date each
    // year, so repeating them would put next year's festival on the wrong day.
    repeatsYearly: { type: Boolean, default: false },
    // From when a repeat is allowed to affect WORKING-DAY counting. Set to the day the
    // repeat was switched on, so turning it on can never reach back and rewrite an
    // attendance sheet or a report that has already been read and acted on. The
    // calendar still SHOWS the entry in every year — only the maths is bounded.
    repeatsFromYMD: { type: String, default: '' },
    // For a BIRTHDAY entry, the person it belongs to. Set when it's created/edited by
    // picking an employee (or when their profile date-of-birth is saved), so the calendar
    // entry and the user's `dateOfBirth` stay in sync. null = a plain, unlinked entry
    // (a free-typed name, or any non-birthday row) — kept working exactly as before.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

holidaySchema.set('toJSON', { virtuals: true, versionKey: false });

export const Holiday = mongoose.models.Holiday || mongoose.model('Holiday', holidaySchema);
