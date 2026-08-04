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

// Editing an existing entry: every field optional, and — unlike addDueSchema.partial() —
// NO defaults, so an omitted field is left untouched instead of being blanked to ''. `kind`
// and `person` are never editable, so they aren't accepted here at all.
export const updateEntrySchema = z.object({
  amount: amount.optional(),
  item: z.string().max(120).optional(),
  source: z.string().max(120).optional(),
  dateYMD: ymd.optional(),
  note: z.string().max(300).optional(),
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

// The Admin Manager's UPI for collecting dues. Empty upiId clears it (hides the button).
const vpa = z.string().trim().regex(/^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z0-9.\-_]{2,}$/, 'Enter a valid UPI ID like name@bank');
export const setUpiSchema = z.object({
  upiId: z.union([vpa, z.literal('')]).default(''),
  upiName: z.string().trim().max(80).optional().default(''),
});
