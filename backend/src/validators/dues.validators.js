import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-MM-dd');
const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid person');
// Up to ₹10,00,000 per entry (paise) — a sane upper bound.
const amount = z.coerce.number().int().positive('Amount must be greater than 0').max(100000000);

export const addDueSchema = z.object({
  person: objectId,
  amount,
  item: z.string().max(120).optional().default(''),
  source: z.string().max(120).optional().default(''),
  dateYMD: ymd,
  note: z.string().max(300).optional().default(''),
});

export const addPaymentSchema = z.object({
  person: objectId,
  amount,
  dateYMD: ymd,
  note: z.string().max(300).optional().default(''),
});

export const settleSchema = z.object({
  person: objectId,
});

export const settleEntrySchema = z.object({
  entryId: objectId,
});
