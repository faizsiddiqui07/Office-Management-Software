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
  },
  { timestamps: true },
);

settingSchema.set('toJSON', { virtuals: true, versionKey: false });

settingSchema.statics.getSingleton = async function getSingleton() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

export const Setting = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
