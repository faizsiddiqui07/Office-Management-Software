import mongoose from 'mongoose';

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    companyName: { type: String, default: 'Office Management' },
    logoUrl: { type: String, default: '' }, // legacy — mirrors the dark logo
    logoLight: { type: String, default: '' }, // shown on light backgrounds (light theme)
    logoDark: { type: String, default: '' }, // shown on dark backgrounds (dark theme)
    bgLight: { type: String, default: '' }, // app background photo for light theme
    bgDark: { type: String, default: '' }, // app background photo for dark theme
    // Brand accent used to theme generated PDF reports (#RRGGBB).
    brandColor: { type: String, default: '#E5342B' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    workStart: { type: String, default: '10:00' },
    workEnd: { type: String, default: '18:00' },
    graceMinutes: { type: Number, default: 0 },
    // Minutes after check-in during which check-out stays locked. Stops the common
    // mishap where a slow phone makes someone tap again — the button has already
    // flipped to "Check out" — and they instantly check themselves out. 0 = off.
    checkOutCooldownMinutes: { type: Number, default: 30 },
    // Day-of-week numbers that are weekends (0 = Sunday … 6 = Saturday).
    weekendDays: { type: [Number], default: [0] },
    annualLeaveQuota: { type: Number, default: 18 },
    currency: { type: String, default: 'INR' },
    expenseCategories: {
      type: [String],
      default: ['OFFICE_SUPPLIES', 'UTILITIES', 'TRAVEL', 'FOOD', 'MAINTENANCE', 'SALARY', 'MISC'],
    },
    // Visitor-entry categories (leadership can add more). Plain labels.
    visitorCategories: {
      type: [String],
      default: ['Visitors', 'Finance'],
    },
    // Outgoing email (SMTP) account, configurable from Settings. The app-password
    // is stored ENCRYPTED (see lib/secretBox.js) and is NEVER sent to the client
    // — the toJSON transform below strips it and exposes only `smtpConfigured`.
    // Blank user/pass → the server falls back to the SMTP_* environment variables.
    smtpUser: { type: String, default: '' }, // sender email (e.g. a Gmail address)
    smtpPassEnc: { type: String, default: '' }, // encrypted app-password (write-only)
    smtpHost: { type: String, default: '' }, // blank → smtp.gmail.com
    smtpPort: { type: Number, default: 0 }, // 0 → 587
    // Bumped by one-time role/permission data migrations (see lib/roles.js).
    rolesSchemaVersion: { type: Number, default: 1 },
    // In-app alert to leadership when an employee checks in.
    checkinAlerts: {
      enabled: { type: Boolean, default: true },
      onlyLate: { type: Boolean, default: false },
    },
    // Geo-fenced attendance: when enabled, check-in/out is only allowed within
    // `radiusMeters` of the office location (strict block outside).
    gpsAttendance: {
      enabled: { type: Boolean, default: false },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      radiusMeters: { type: Number, default: 200 },
    },
    // Configurable bonus-points system (monthly). Point values are set by leadership
    // here — never hardcoded. 0 on any auto rule turns that rule off.
    bonus: {
      enabled: { type: Boolean, default: false },
      rupeesPerPoint: { type: Number, default: 0 },
      graceDays: { type: Number, default: 1 }, // extra days after a task's due date before it counts "late"
      streakDays: { type: Number, default: 10 }, // N consecutive on-time days = one punctual-streak award
      // Which automatic rules are ON + their point values. Keys come from the
      // AUTO_RULES catalog in bonus.service; a rule not in this list is off.
      autoRules: {
        type: [{ _id: false, key: String, points: Number }],
        default: [],
      },
      // CEO's manual award/penalty catalog. `points` may be negative (a penalty).
      manualItems: {
        type: [{ _id: false, id: String, label: String, points: Number }],
        default: [],
      },
      lastPenaltyRun: { type: String, default: '' }, // YMD — throttles the daily scan
      lastMonthRollup: { type: String, default: '' }, // YYYY-MM — last month whose month-end awards ran
      // YMD — the last day the absence scan actually FINISHED. Separate from the
      // throttle above so a failed run doesn't quietly declare its days done.
      lastAbsenceScan: { type: String, default: '' },
    },
    // The four national holidays are put in once, on first boot. This flag is what
    // stops them coming back: delete Christmas and it stays deleted, instead of being
    // helpfully re-created on the next Lambda cold start.
    defaultHolidaysSeeded: { type: Boolean, default: false },
    // YMD — the last day the team was pushed a birthday wish. Throttles the once-a-day
    // birthday announcement (no cron on Lambda; it rides on the dashboard load).
    lastBirthdayPing: { type: String, default: '' },
    // Days the office has been declared work-from-home for, with the announcement each
    // one posted. Claiming the day here BEFORE announcing keeps a double-press (or a
    // Lambda retry) from posting twice; keeping the announcement id means undoing the
    // day can retire its announcement too, instead of leaving the office told about a
    // day that no longer exists.
    wfhDays: {
      type: [{ _id: false, ymd: String, announcementId: { type: mongoose.Schema.Types.ObjectId, default: null } }],
      default: [],
    },
  },
  { timestamps: true },
);

settingSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    // The SMTP app-password is write-only: expose a boolean, never the secret.
    ret.smtpConfigured = !!(ret.smtpUser && ret.smtpPassEnc);
    delete ret.smtpPassEnc;
    return ret;
  },
});

/**
 * The settings document is read constantly — office hours, weekends, currency, the
 * bonus rules — from roughly fifty places. A single leadership dashboard walked
 * through six to ten of them, and every one was its own round trip to Atlas from
 * Lambda for a document that changes a few times a year.
 *
 * So it's held for a few seconds between reads, the same way the role cache works.
 * The window is deliberately short: a settings change made on one instance shows up on
 * the others within it, and saving invalidates the cache on the instance that saved so
 * the writer never reads back its own stale copy.
 */
let cached = null;
let cachedAt = 0;
// Short on purpose. It exists to collapse the six-to-ten reads inside ONE request, not
// to hold settings between them: every instance keeps its own copy, so a change saved
// on one is invisible to the others until theirs expires, and a longer window would let
// the settings form read back its own change as if it had reverted.
const FRESH_MS = 3_000;

function clearSettingCache() {
  cached = null;
  cachedAt = 0;
}

settingSchema.statics.getSingleton = async function getSingleton() {
  if (cached && Date.now() - cachedAt < FRESH_MS) return cached;
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  cached = doc;
  cachedAt = Date.now();
  return doc;
};

/** Drop the cache — call after writing settings through anything but `save()`. */
settingSchema.statics.invalidateCache = clearSettingCache;

// Any save (including the ones that go through a cached doc) makes the copy suspect.
settingSchema.post('save', clearSettingCache);
settingSchema.post('findOneAndUpdate', clearSettingCache);
settingSchema.post('updateOne', clearSettingCache);

export const Setting = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
