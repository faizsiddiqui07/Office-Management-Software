import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const applyLeaveSchema = z.object({
  type: z.enum(['CASUAL', 'SICK', 'PAID', 'UNPAID']),
  startYMD: ymd,
  endYMD: ymd,
  halfDay: z.boolean().optional().default(false),
  halfDayPart: z.enum(['FIRST', 'SECOND']).optional(),
  reason: z.string().max(500).optional().default(''),
});

export const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(500).optional().default(''),
});

export const listLeavesQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  userId: z.string().optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  queue: z.union([z.literal('true'), z.literal('false')]).optional(),
});
