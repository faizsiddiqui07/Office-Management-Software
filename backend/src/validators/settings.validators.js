import { z } from 'zod';

const hm = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:mm');

export const updateSettingsSchema = z.object({
  companyName: z.string().min(1).max(120).optional(),
  logoUrl: z.string().max(500).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB').optional(),
  timezone: z.string().min(1).optional(),
  workStart: hm.optional(),
  workEnd: hm.optional(),
  graceMinutes: z.coerce.number().int().min(0).max(180).optional(),
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
