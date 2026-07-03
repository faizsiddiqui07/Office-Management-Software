import { z } from 'zod';
import { getRolePermissionSet } from '../lib/roles.js';

const isRole = (r) => getRolePermissionSet(r) !== null;

// A blank time is allowed — it means "follow the office hours" (custom timing off).
const hm = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:mm').or(z.literal(''));
const employmentType = z.enum(['FULL_TIME', 'PART_TIME']);
const scheduleSchema = z.object({
  workStart: hm.optional(),
  workEnd: hm.optional(),
  graceMinutes: z.coerce.number().int().min(0).max(180).optional(),
  workDays: z.array(z.coerce.number().int().min(0).max(6)).optional(),
});


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
  });

export const leaveBalanceSchema = z
  .object({
    totalQuota: z.coerce.number().int().min(0).max(365).optional(),
    used: z.coerce.number().int().min(0).max(365).optional(),
  })
  .refine((v) => v.totalQuota !== undefined || v.used !== undefined, {
    message: 'Provide quota and/or used days',
  });

/** Per-person task-delegation access (set by leadership in Users → Edit). */
const taskAssignSchema = z.object({
  mode: z.enum(['NONE', 'ALL', 'SELECTED']),
  users: z.array(z.string()).optional().default([]),
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
    taskAssign: taskAssignSchema.optional(),
  });
