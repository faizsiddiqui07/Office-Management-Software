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
    },
    // The four national holidays are put in once, on first boot. This flag is what
    // stops them coming back: delete Christmas and it stays deleted, instead of being
    // helpfully re-created on the next Lambda cold start.
    defaultHolidaysSeeded: { type: Boolean, default: false },
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

settingSchema.statics.getSingleton = async function getSingleton() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

export const Setting = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
