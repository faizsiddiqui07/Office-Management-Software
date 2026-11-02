import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, default: '' }, // plain/rich text — rendered escaped on the client
    priority: { type: String, enum: ['NORMAL', 'IMPORTANT', 'URGENT'], default: 'NORMAL', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Who it is addressed to. Two lists, one rule:
    //   both empty            → everyone
    //   audienceUsers filled  → exactly those people
    //   else audienceRoles    → anybody holding one of those roles
    // The dialog is a switch, so the service CLEARS one list whenever the other is set —
    // a post never carries both, and a list left lying around cannot come back to life on
    // some later edit. The read filters are a union anyway, so a row that somehow carries
    // both is shown to the union of the two rather than to nobody.
    audienceRoles: { type: [String], default: [] },
    audienceUsers: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
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
    // Repeats (owner's rule, 11 Sep 2026; lists added 2 Nov 2026): every week on one or
    // more weekdays, every month on one or more dates, every year on dates within a month,
    // or only on a handful of named calendar days — at `time` (HH:mm, company timezone).
    // The date arithmetic — including what "the 31st" means in April, and the fact that
    // DATES is deliberately NOT clamped — lives in lib/recurrence.js. Old rows have no
    // `recurrence` at all; read that as NONE.
    //
    // `weekday` and `dayOfMonth` are the SINGLE-day fields this started with. They are
    // still READ, because rows written before the lists existed hold nothing else, but
    // nothing writes them any more — normalizeRule migrates a single day into its list and
    // leaves the old field null. Always read a rule through weekdaysOf/monthDays/ruleDates
    // so both shapes answer the same.
    //
    // `recurrence.type` must stay a plain { type, enum, default } object: that shape is
    // what makes mongoose treat `recurrence` as a NESTED path, which is what makes the
    // three arrays below real schema paths. Shortened to `type: String` and the whole
    // sub-object collapses. Leaving an array OUT is the quietest failure in this file —
    // strict mode drops the value with no error, even on an explicit .set(), so the post
    // simply never goes out.
    recurrence: {
      type: { type: String, enum: ['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY', 'DATES'], default: 'NONE' },
      weekday: { type: Number, default: null }, // legacy single day, 0 = Sunday … 6 = Saturday
      weekdays: { type: [Number], default: [] }, // 0–6, deduped + sorted by normalizeRule
      dayOfMonth: { type: Number, default: null }, // legacy single day, 1–31
      daysOfMonth: { type: [Number], default: [] }, // 1–31, deduped + sorted
      month: { type: Number, default: null }, // 1–12
      dates: { type: [String], default: [] }, // 'YYYY-MM-DD', deduped + sorted — DATES only
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
