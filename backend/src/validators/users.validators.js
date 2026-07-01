import { z } from 'zod';
import { getRolePermissionSet } from '../lib/roles.js';

const isRole = (r) => getRolePermissionSet(r) !== null;

const hm = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:mm');
const employmentType = z.enum(['FULL_TIME', 'PART_TIME']);
const scheduleSchema = z.object({
  workStart: hm.optional(),
  workEnd: hm.optional(),
  graceMinutes: z.coerce.number().int().min(0).max(180).optional(),
});

/** Part-timers must specify their check-in and check-out times. */
const requirePartTimeHours = (v, ctx) => {
  if (v.employmentType === 'PART_TIME' && (!v.schedule?.workStart || !v.schedule?.workEnd)) {
    ctx.addIssue({ code: 'custom', message: 'Part-time needs a check-in and check-out time', path: ['schedule'] });
  }
};

export const createUserSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email(),
    role: z.string().refine(isRole, { message: 'Invalid role' }),
    department: z.string().optional().default(''),
    designation: z.string().optional().default(''),
    phone: z.string().optional().default(''),
    reportsTo: z.string().optional().nullable(),
    employmentType: employmentType.optional(),
    schedule: scheduleSchema.optional(),
    // Optional chosen temp password; if omitted a strong one is generated.
    temporaryPassword: z.string().min(8, 'Temporary password must be at least 8 characters').optional(),
  })
  .superRefine(requirePartTimeHours);

export const leaveBalanceSchema = z
  .object({
    totalQuota: z.coerce.number().int().min(0).max(365).optional(),
    used: z.coerce.number().int().min(0).max(365).optional(),
  })
  .refine((v) => v.totalQuota !== undefined || v.used !== undefined, {
    message: 'Provide quota and/or used days',
  });

export const updateUserSchema = z
  .object({
    name: z.string().min(1).optional(),
    department: z.string().optional(),
    designation: z.string().optional(),
    phone: z.string().optional(),
    reportsTo: z.string().nullable().optional(),
    role: z.string().refine(isRole, { message: 'Invalid role' }).optional(),
    isActive: z.boolean().optional(),
    employmentType: employmentType.optional(),
    schedule: scheduleSchema.optional(),
  })
  .superRefine(requirePartTimeHours);
