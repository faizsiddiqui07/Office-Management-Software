import mongoose from 'mongoose';

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    companyName: { type: String, default: 'Office Management' },
    logoUrl: { type: String, default: '' }, // legacy — mirrors the dark logo
    logoLight: { type: String, default: '' }, // shown on light backgrounds (light theme)
    logoDark: { type: String, default: '' }, // shown on dark backgrounds (dark theme)
    appIcon: { type: String, default: '' }, // square app mark — favicon / PWA install icon / compact header
    bgLight: { type: String, default: '' }, // app background photo for light theme
    bgDark: { type: String, default: '' }, // app background photo for dark theme
    // Brand accent used to theme generated PDF reports (#RRGGBB).
    brandColor: { type: String, default: '#E5342B' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    workStart: { type: String, default: '10:00' },
    workEnd: { type: String, default: '18:00' },
    graceMinutes: { type: Number, default: 0 },
    // Overtime only counts after this many minutes PAST the shift end. e.g. shift ends
    // 6 PM + 60 = overtime is the time worked past 7 PM. 0 = counts from the shift end.
    // Lets the office hours stay honest (10–6) while overtime still begins an hour later.
    overtimeAfterMinutes: { type: Number, default: 0 },
    // Minutes after check-in during which check-out stays locked. Stops the common
    // mishap where a slow phone makes someone tap again — the button has already
    // flipped to "Check out" — and they instantly check themselves out. 0 = off.
    checkOutCooldownMinutes: { type: Number, default: 30 },
    // Day-of-week numbers that are weekends (0 = Sunday … 6 = Saturday).
    weekendDays: { type: [Number], default: [0] },
    annualLeaveQuota: { type: Number, default: 18 },
    currency: { type: String, default: 'INR' },
    // UPI account that personal dues are paid into. Owned by the Admin Manager (who
    // fronts the cash), so it is edited from the Dues page under `manageDues` — NOT the
    // leadership Settings screen. Everyone's "Pay via UPI" button targets this one id.
    duesUpiId: { type: String, default: '' }, // VPA, e.g. name@bank
    duesUpiName: { type: String, default: '' }, // optional payee display name
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
      // 'YYYY-MM' — the last past month scored by the one-time history catch-up. The
      // scheme is usually switched on part-way through the office's life, leaving the
      // months before it unscored even though everything they need was recorded; this
      // walks forward through them once so nobody's earlier work is simply missing.
      historyScored: { type: String, default: '' },
      // Bumped when the way tasks are scored changes, so a one-time re-score of existing
      // point entries runs once after a deploy (see rescoreAssignedTasks) and not again.
      rescoreVersion: { type: String, default: '' },
      // Set once the forwarding reward rules (forwardOnTime / forwardLate) have been seeded
      // into autoRules, so leadership can then edit or remove them without them re-appearing.
      forwardRuleSeeded: { type: Boolean, default: false },
      // Same guard for the escalating per-day overdue penalty rule.
      overdueDripSeeded: { type: Boolean, default: false },
      // One-time flag: punctual-week labels rewritten to read by the week-ending day.
      streakLabelFixed: { type: Boolean, default: false },
      // One-time flag: streak earnedYMD/labels moved onto the real week-ending Saturday
      // (an old repair had copied the key's MONDAY into earnedYMD).
      streakDatesFixed: { type: Boolean, default: false },
      // One-time flag: overdue-pending penalties (mark + drip) on July-due tasks removed.
      julyOverdueCleaned: { type: Boolean, default: false },
      lastMonthRollup: { type: String, default: '' }, // YYYY-MM — last month whose month-end awards ran
      // YMD — the last day the absence scan actually FINISHED. Separate from the
      // throttle above so a failed run doesn't quietly declare its days done.
      lastAbsenceScan: { type: String, default: '' },
      // One-time flag: the owner's 2026-08-08 overdue rule (-5 with no month floor, drip
      // runs while a submission waits) back-filled the drip days the old scan skipped.
      overdueRuleV2: { type: Boolean, default: false },
      // One-time flag: weekly "punctual week" awards wiped and the whole history
      // re-scored under the rolling 6-day streak rule (owner's call, 2026-08-08).
      streakV2: { type: Boolean, default: false },
      // YMD — the last day the rolling punctual-streak scan judged; it walks forward
      // from here, so each day is classified exactly once.
      lastStreakScan: { type: String, default: '' },
      // Per-user rolling streak counters as of lastStreakScan: { userId: daysSoFar }.
      streakRuns: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    // The four national holidays are put in once, on first boot. This flag is what
    // stops them coming back: delete Christmas and it stays deleted, instead of being
    // helpfully re-created on the next Lambda cold start.
    defaultHolidaysSeeded: { type: Boolean, default: false },
    // The Rules & Regulations page's starting content is written once; after that the
    // page belongs to the CEO's edits (a deliberately emptied page stays empty).
    rulesSeeded: { type: Boolean, default: false },
    // Bumped when the DEFAULT rule wording changes post-seed; migrateRuleText applies the
    // new text to rules still carrying the old default (CEO-edited rules are left alone).
    rulesTextVersion: { type: Number, default: 0 },
    // YMD — the last day the team was pushed a birthday wish. Throttles the once-a-day
    // birthday announcement (no cron on Lambda; it rides on the dashboard load).
    lastBirthdayPing: { type: String, default: '' },
    // The end-of-day round-up the owners see: after this time, opening the app once
    // shows what everyone finished today. Nothing is stored — it is read live off the
    // tasks, and closing it only sets a flag on that device for that day.
    eodDigest: {
      enabled: { type: Boolean, default: true },
      time: { type: String, default: '19:00' }, // 'HH:mm' company time
      // YMD — last day the leadership attendance round-up push was sent. Throttles it to
      // once a day off the EventBridge schedule (see dayDigest.service).
      digestLastRun: { type: String, default: '' },
    },
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

/**
 * The five base64-image fields (logos + the two background photos). Together they are
 * ~0.9 MB of the document while EVERYTHING else is ~3 KB — and on a bandwidth-throttled
 * Atlas tier that 0.9 MB took ~9.5s per fetch (measured), which is what made every
 * settings-reading endpoint crawl. getSingleton therefore EXCLUDES them; the few places
 * that genuinely render images use getBranding()/getFullSingleton() below.
 */
const HEAVY_FIELDS = ['logoUrl', 'logoLight', 'logoDark', 'appIcon', 'bgLight', 'bgDark'];
const LEAN_PROJECTION = HEAVY_FIELDS.map((f) => `-${f}`).join(' ');

let brandingCached = null;
let brandingAt = 0;
// Branding changes ~a few times a year; each cache miss is an expensive ~0.9 MB pull, so
// hold it much longer than the config cache. Saving settings clears it (same hooks).
const BRANDING_FRESH_MS = 5 * 60_000;

function clearSettingCache() {
  cached = null;
  cachedAt = 0;
  brandingCached = null;
  brandingAt = 0;
  fullCached = null;
  fullAt = 0;
}

let inFlight = null; // dedup: a burst of parallel readers shares ONE fetch instead of N

settingSchema.statics.getSingleton = async function getSingleton() {
  if (cached && Date.now() - cachedAt < FRESH_MS) return cached;
  if (!inFlight) {
    inFlight = (async () => {
      // Exclusion projection: mongoose only $sets modified paths on save(), so a doc
      // loaded without the image fields can still be safely saved — the images in the
      // database are never touched (verified by test).
      let doc = await this.findOne({ key: 'global' }).select(LEAN_PROJECTION);
      if (!doc) {
        await this.create({ key: 'global' });
        doc = await this.findOne({ key: 'global' }).select(LEAN_PROJECTION);
      }
      cached = doc;
      cachedAt = Date.now();
      return doc;
    })().finally(() => { inFlight = null; });
  }
  return inFlight;
};

/**
 * The brand images (plus name/colour), plain object, long-cached. Since images moved to
 * the assets bucket these fields are ~100-byte URLs, so the login page can carry the
 * backgrounds too. (Legacy base64 values still work — they're just bigger until the CEO
 * re-uploads through Settings and they become S3 URLs.)
 */
settingSchema.statics.getBranding = async function getBranding() {
  if (brandingCached && Date.now() - brandingAt < BRANDING_FRESH_MS) return brandingCached;
  const doc = await this.findOne({ key: 'global' })
    .select('companyName brandColor logoUrl logoLight logoDark appIcon bgLight bgDark')
    .lean();
  brandingCached = {
    companyName: doc?.companyName || 'Office Management',
    brandColor: doc?.brandColor || '#E5342B',
    logoUrl: doc?.logoUrl || '',
    logoLight: doc?.logoLight || '',
    logoDark: doc?.logoDark || '',
    appIcon: doc?.appIcon || '',
    bgLight: doc?.bgLight || '',
    bgDark: doc?.bgDark || '',
  };
  brandingAt = Date.now();
  return brandingCached;
};

/** Just the three logo fields (long-cached via getBranding) — for PDF headers. */
settingSchema.statics.getLogos = async function getLogos() {
  const b = await this.getBranding();
  return { logoUrl: b.logoUrl, logoLight: b.logoLight, logoDark: b.logoDark };
};

let fullCached = null;
let fullAt = 0;

/**
 * The COMPLETE document (images included) — the settings screens and GET /settings (which
 * the app shell fetches on every page for the background photos). Cached like branding:
 * each miss is the expensive ~0.9 MB pull, and any save clears it (post-save hooks below).
 */
settingSchema.statics.getFullSingleton = async function getFullSingleton() {
  if (fullCached && Date.now() - fullAt < BRANDING_FRESH_MS) return fullCached;
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  fullCached = doc;
  fullAt = Date.now();
  return doc;
};

/** Drop the cache — call after writing settings through anything but `save()`. */
settingSchema.statics.invalidateCache = clearSettingCache;

// Any save (including the ones that go through a cached doc) makes the copy suspect.
settingSchema.post('save', clearSettingCache);
settingSchema.post('findOneAndUpdate', clearSettingCache);
settingSchema.post('updateOne', clearSettingCache);

export const Setting = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
