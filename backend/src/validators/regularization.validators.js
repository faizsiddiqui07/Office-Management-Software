import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-MM-dd');
const hm = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'Expected HH:mm')
  .nullable()
  .optional()
  .or(z.literal(''));

export const createRegSchema = z.object({
  dateYMD: ymd,
  checkIn: hm,
  checkOut: hm,
  reason: z.string().min(3, 'Add a short reason').max(300),
});

export const decideRegSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(300).optional().default(''),
});
