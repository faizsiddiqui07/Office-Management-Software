import { z } from 'zod';
import { ymdInTz } from '../lib/time.js';
import { APP_LIVE_YMD } from '../lib/appLive.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-MM-dd');
const hm = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'Expected HH:mm')
  .nullable()
  .optional()
  .or(z.literal(''));

export const createRegSchema = z
  .object({
    dateYMD: ymd,
    checkIn: hm,
    checkOut: hm,
    reason: z.string().min(3, 'Add a short reason').max(300),
  })
  // The dialog already enforces both of these, but a request that doesn't come from
  // the dialog was accepted as-is: a correction for a day that hasn't happened, or a
  // check-out before the check-in, which approves into a "present for 0 minutes" day.
  .refine((v) => !v.checkIn || !v.checkOut || v.checkOut > v.checkIn, {
    message: 'Check-out must be after check-in',
    path: ['checkOut'],
  })
  .refine((v) => v.dateYMD <= ymdInTz(new Date()), {
    message: 'You can only correct a day that has already happened',
    path: ['dateYMD'],
  })
  .refine((v) => v.dateYMD >= APP_LIVE_YMD, {
    message: 'Nothing was recorded before the office started using this system',
    path: ['dateYMD'],
  });

export const decideRegSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(300).optional().default(''),
});
