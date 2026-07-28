import { z } from 'zod';
import { ymdInTz } from '../lib/time.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
/**
 * A spend date that has already happened. The dialog caps its picker at today, but only
 * the dialog did — a future-dated expense can't even be found afterwards (the filter's
 * custom range also stops at today), so it sits unseen until its date arrives and then
 * lands in that period's total.
 */
const pastYmd = ymd.refine((v) => v <= ymdInTz(new Date()), { message: 'The date cannot be in the future' });

export const createExpenseSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  // Minor units (paise) — coerced because multipart fields arrive as strings.
  amount: z.coerce.number().int('Amount must be a whole number of paise').min(0),
  currency: z.string().optional().default('INR'),
  category: z.string().min(1, 'Category is required'),
  dateYMD: pastYmd,
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
