import { z } from 'zod';
import { ROLES } from '../lib/permissions.js';

export const createAnnouncementSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  body: z.string().max(5000).optional().default(''),
  priority: z.enum(['NORMAL', 'IMPORTANT', 'URGENT']).optional().default('NORMAL'),
  audienceRoles: z
    .array(z.string().refine((r) => ROLES.includes(r), { message: 'Invalid role' }))
    .optional()
    .default([]),
  publishAt: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
});

export const updateAnnouncementSchema = createAnnouncementSchema.partial();
