import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const createExpenseSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  // Minor units (paise) — coerced because multipart fields arrive as strings.
  amount: z.coerce.number().int('Amount must be a whole number of paise').min(0),
  currency: z.string().optional().default('INR'),
  category: z.string().min(1, 'Category is required'),
  dateYMD: ymd,
  paymentMethod: z.enum(['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'OTHER']).optional().default('CASH'),
  vendor: z.string().max(200).optional().default(''),
  notes: z.string().max(1000).optional().default(''),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export const listExpensesQuerySchema = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  category: z.string().optional(),
  paymentMethod: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).optional(),
});

export const summaryQuerySchema = z.object({
  // Either a named period plus an anchor date — resolved on the server so the fiscal
  // year matches the reports module and a device in the wrong timezone can't shift it
  // — or a plain from/to window, which is how the older callers ask.
  period: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']).optional(),
  date: ymd.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  // The same filters the list takes, so the totals describe the rows underneath them.
  category: z.string().optional(),
  paymentMethod: z.string().optional(),
  search: z.string().optional(),
});
