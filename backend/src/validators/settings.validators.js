import { z } from 'zod';

const hm = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:mm');

/** A valid IANA time zone (rejects free text like "IST | INDIA" that would crash date formatting). */
const timeZone = z.string().min(1).refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Enter a valid IANA time zone, e.g. Asia/Kolkata' },
);

export const updateSettingsSchema = z.object({
  companyName: z.string().min(1).max(120).optional(),
  logoUrl: z.string().max(500).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB').optional(),
  timezone: timeZone.optional(),
  workStart: hm.optional(),
  workEnd: hm.optional(),
  graceMinutes: z.coerce.number().int().min(0).max(180).optional(),
  checkOutCooldownMinutes: z.coerce.number().int().min(0).max(480).optional(),
  weekendDays: z.array(z.coerce.number().int().min(0).max(6)).optional(),
  annualLeaveQuota: z.coerce.number().int().min(0).max(365).optional(),
  currency: z.string().min(1).max(8).optional(),
  expenseCategories: z.array(z.string().min(1).max(40)).optional(),
  checkinAlerts: z
    .object({
      enabled: z.boolean().optional(),
      onlyLate: z.boolean().optional(),
    })
    .optional(),
  gpsAttendance: z
    .object({
      enabled: z.boolean().optional(),
      latitude: z.number().min(-90).max(90).nullable().optional(),
      longitude: z.number().min(-180).max(180).nullable().optional(),
      radiusMeters: z.coerce.number().int().min(10).max(5000).optional(),
    })
    .optional(),
});

/**
 * Configure the outgoing email account. `smtpPass` is optional — when blank the
 * server keeps the currently stored (encrypted) password. `currentPassword` is
 * the caller's own account password, required to re-authorise the change.
 */
export const updateSmtpSchema = z.object({
  smtpUser: z.string().trim().email('Enter a valid sender email').max(200),
  smtpPass: z.string().max(200).optional(),
  smtpHost: z.string().trim().max(200).optional(),
  smtpPort: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce.number().int().min(1).max(65535).optional(),
  ),
  currentPassword: z.string().min(1, 'Enter your account password'),
});
