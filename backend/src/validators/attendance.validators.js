import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const listQuerySchema = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  userId: z.string().optional(),
  all: z.union([z.literal('true'), z.literal('false')]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  // `fill=true` → khaali din bhi bharo (Sunday, holiday, absent). Opt-in JAAN-BOOJH kar
  // hai: CSV export aur Everyone tab isi raaste se aate hain aur unhe asli rows hi
  // chahiye. Ye sirf EK bande ki apni history ke liye hai.
  fill: z.union([z.literal('true'), z.literal('false')]).optional(),
});

export const overviewQuerySchema = z.object({
  date: ymd.optional(),
});
