import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, default: '' }, // plain/rich text — rendered escaped on the client
    priority: { type: String, enum: ['NORMAL', 'IMPORTANT', 'URGENT'], default: 'NORMAL', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    audienceRoles: { type: [String], default: [] }, // empty = everyone
    isActive: { type: Boolean, default: true },
    publishAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    // When the audience was told about it. Set as soon as it's announced — on creation
    // for an immediate post, or when a scheduled one comes due — so it is announced
    // exactly once no matter how many instances notice it at the same moment.
    notifiedAt: { type: Date, default: null },
    // When it was LAST announced — what the feed sorts on. For a one-off post this is the
    // same moment as notifiedAt; for a repeating one it moves forward every time it goes
    // out again, which is what carries it back to the top of the feed.
    announcedAt: { type: Date, default: null },
    // Repeats (owner's rule, 11 Sep 2026): every week on a weekday, every month on a
    // date, or every year on a month-and-date, at `time` (HH:mm, company timezone). The
    // date arithmetic — including what "the 31st" means in April — lives in
    // lib/recurrence.js. Old rows have no `recurrence` at all; read that as NONE.
    recurrence: {
      type: { type: String, enum: ['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY'], default: 'NONE' },
      weekday: { type: Number, default: null }, // 0 = Sunday … 6 = Saturday
      dayOfMonth: { type: Number, default: null }, // 1–31
      month: { type: Number, default: null }, // 1–12
      time: { type: String, default: '09:00' },
    },
    // The claim stamp for repeats: the last day it went out (or is booked to go out).
    // The scheduler fires only when today is later than this, and claims the day by
    // writing it here first — so two instances noticing the same day can't both send.
    lastRecurredYMD: { type: String, default: '' },
    // Every day it has gone out, newest last, kept short. A record, not a mechanism.
    occurrences: { type: [String], default: [] },
  },
  { timestamps: true },
);

announcementSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Announcement =
  mongoose.models.Announcement || mongoose.model('Announcement', announcementSchema);
