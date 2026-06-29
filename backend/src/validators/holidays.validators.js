import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const createHolidaySchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  type: z.enum(['HOLIDAY', 'EVENT', 'OPTIONAL_HOLIDAY']).optional().default('HOLIDAY'),
  startYMD: ymd,
  endYMD: ymd.optional(),
  description: z.string().max(1000).optional().default(''),
});

export const updateHolidaySchema = createHolidaySchema.partial();

export const listHolidaysQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  from: ymd.optional(),
  to: ymd.optional(),
});
