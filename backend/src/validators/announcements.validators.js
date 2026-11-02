import { z } from 'zod';
import { isRealYMD, MAX_RULE_DATES } from '../lib/recurrence.js';

// A repeat rule. The type says which fields matter; the refine insists they are there,
// so "WEEKLY with no weekday" is rejected at the door instead of becoming a post that
// never goes out. Extra fields for a different type are dropped by the service.
//
// Every day-field comes in two shapes: a LIST (what the dialog sends since 2 Nov 2026) and
// the old SINGLE day, which is still accepted — a phone running a cached copy of the app
// sends the old shape for weeks after a deploy, and refusing it would make the app unable
// to save anything at all.
//
// Two traps live in here. A key that is not declared is STRIPPED by zod without a word, so
// forgetting one means the dates vanish between the browser and the database and the
// request still answers 201. And the refines must test LENGTH, not `=== undefined`: an
// empty array is defined, and an empty list reaches date arithmetic that has no day to
// work from. Nor may the caps be dropped — without `.max()` an array of two thousand
// entries passes.
//
// The list keys sit INSIDE the object literal on purpose: `.superRefine()` returns a
// ZodEffects, which has no `.extend()`, so there is no adding to this afterwards.
const recurrenceSchema = z
  .object({
    type: z.enum(['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY', 'DATES']),
    weekday: z.number().int().min(0).max(6).nullable().optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    daysOfMonth: z.array(z.number().int().min(1).max(31)).max(31).optional(),
    month: z.number().int().min(1).max(12).nullable().optional(),
    // Checked as a REAL day, not just the shape: '2027-02-31' matches the pattern, never
    // equals any day on the calendar, and would leave the post sitting there forever.
    dates: z
      .array(z.string().refine(isRealYMD, 'That is not a real date'))
      .max(MAX_RULE_DATES, `Pick at most ${MAX_RULE_DATES} dates`)
      .optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm').optional(),
  })
  .superRefine((r, ctx) => {
    const noWeekday = !r.weekdays?.length && r.weekday == null;
    const noDay = !r.daysOfMonth?.length && r.dayOfMonth == null;
    if (r.type === 'WEEKLY' && noWeekday) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Pick at least one day of the week' });
    if (r.type === 'MONTHLY' && noDay) ctx.addIssue({ code: 'custom', path: ['daysOfMonth'], message: 'Pick at least one date of the month' });
    if (r.type === 'YEARLY' && (r.month == null || noDay)) ctx.addIssue({ code: 'custom', path: ['daysOfMonth'], message: 'Pick a month and at least one date' });
    if (r.type === 'DATES' && !r.dates?.length) ctx.addIssue({ code: 'custom', path: ['dates'], message: 'Pick at least one date' });
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
  // Named people instead of roles. Shape only again — whether an id belongs to somebody
  // still with the office is a question for the database, and the service asks it. The
  // 24-hex check is here rather than there because a non-id string makes User.find() throw
  // a CastError, which reaches the browser as a 500 and "Something went wrong".
  audienceUsers: z
    .array(z.string().regex(/^[a-f\d]{24}$/i, 'Pick the people from the list'))
    .max(200)
    .optional()
    .default([]),
  publishAt: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
  recurrence: recurrenceSchema.optional(),
});

export const updateAnnouncementSchema = createAnnouncementSchema.partial();
