import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// Kept as a plain object so `.partial()` still works for the update schema — chaining
// .superRefine() first yields a ZodEffects, which has no .partial().
const holidayFields = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  type: z.enum(['HOLIDAY', 'EVENT', 'OPTIONAL_HOLIDAY', 'BIRTHDAY']).optional().default('HOLIDAY'),
  startYMD: ymd,
  endYMD: ymd.optional(),
  description: z.string().max(1000).optional().default(''),
  repeatsYearly: z.boolean().optional(),
});

// A repeat is shifted year by year and its length added to the shifted start, so
// anything approaching a year long would overlap its own next occurrence and land on
// the same day twice. 364 keeps every occurrence strictly separate. Applied on update
// too — .partial() drops refinements, so it has to be re-attached, not inherited.
const spanRule = (v, ctx) => {
  if (!v.endYMD || !v.startYMD || !v.repeatsYearly) return;
  const days = Math.round((Date.parse(`${v.endYMD}T00:00:00Z`) - Date.parse(`${v.startYMD}T00:00:00Z`)) / 86400000);
  if (days > 364) {
    ctx.addIssue({ code: 'custom', path: ['endYMD'], message: 'A repeating entry can’t be longer than 364 days' });
  }
};

export const createHolidaySchema = holidayFields.superRefine(spanRule);
export const updateHolidaySchema = holidayFields.partial().superRefine(spanRule);

export const listHolidaysQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  from: ymd.optional(),
  to: ymd.optional(),
});
