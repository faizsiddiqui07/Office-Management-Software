import { z } from 'zod';
import { getRolePermissionSet } from '../lib/roles.js';

const isRole = (r) => getRolePermissionSet(r) !== null;

export const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email(),
  role: z.string().refine(isRole, { message: 'Invalid role' }),
  department: z.string().optional().default(''),
  designation: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  reportsTo: z.string().optional().nullable(),
  // Optional chosen temp password; if omitted a strong one is generated.
  temporaryPassword: z.string().min(8, 'Temporary password must be at least 8 characters').optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  phone: z.string().optional(),
  reportsTo: z.string().nullable().optional(),
  role: z.string().refine(isRole, { message: 'Invalid role' }).optional(),
  isActive: z.boolean().optional(),
});
