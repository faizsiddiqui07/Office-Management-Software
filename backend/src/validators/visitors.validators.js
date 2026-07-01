import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const hm = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:mm').or(z.literal(''));

export const createVisitorSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  phone: z.string().max(30).optional().default(''),
  category: z.string().min(1, 'Category is required'),
  fromPlace: z.string().max(200).optional().default(''),
  company: z.string().max(200).optional().default(''),
  toMeet: z.string().max(120).optional().default(''),
  purpose: z.string().max(1000).optional().default(''),
  dateYMD: ymd,
  checkInTime: hm.optional().default(''),
  checkOutTime: hm.optional().default(''),
});

export const updateVisitorSchema = createVisitorSchema.partial();

export const listVisitorsQuerySchema = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(10000).optional(),
  sort: z.enum(['date_desc', 'date_asc', 'name_asc', 'name_desc']).optional(),
});

export const addCategorySchema = z.object({ label: z.string().min(1).max(40) });
