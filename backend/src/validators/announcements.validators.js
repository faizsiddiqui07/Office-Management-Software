import { z } from 'zod';

// A repeat rule. The type says which fields matter; the refine insists they are there,
// so "WEEKLY with no weekday" is rejected at the door instead of becoming a post that
// never goes out. Extra fields for a different type are dropped by the service.
const recurrenceSchema = z
  .object({
    type: z.enum(['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY']),
    weekday: z.number().int().min(0).max(6).nullable().optional(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    month: z.number().int().min(1).max(12).nullable().optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm').optional(),
  })
  .superRefine((r, ctx) => {
    if (r.type === 'WEEKLY' && r.weekday == null) ctx.addIssue({ code: 'custom', message: 'Pick a day of the week' });
    if (r.type === 'MONTHLY' && r.dayOfMonth == null) ctx.addIssue({ code: 'custom', message: 'Pick a day of the month' });
    if (r.type === 'YEARLY' && (r.month == null || r.dayOfMonth == null)) ctx.addIssue({ code: 'custom', message: 'Pick a month and a day' });
  });

export const createAnnouncementSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  body: z.string().max(5000).optional().default(''),
  priority: z.enum(['NORMAL', 'IMPORTANT', 'URGENT']).optional().default('NORMAL'),
  // Shape only. WHICH roles exist is not knowable here: roles live in the database and the
  // office renames and adds them, while a schema is built once at module load. This used to
  // check each key against a hardcoded list of the seven roles the system shipped with — by
  // the time anyone noticed, eight of the office's nine roles were missing from it, so
  // picking any audience but one answered "Invalid request" and only "Everyone" (an empty
  // list, nothing to check) ever worked. The real check lives in the service, against the
  // live roles.
  audienceRoles: z.array(z.string()).optional().default([]),
  publishAt: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
  recurrence: recurrenceSchema.optional(),
});

export const updateAnnouncementSchema = createAnnouncementSchema.partial();
