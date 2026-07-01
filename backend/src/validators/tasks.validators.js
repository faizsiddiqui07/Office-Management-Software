import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').or(z.literal(''));

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Add the work').max(300),
  notes: z.string().max(2000).optional().default(''),
  dueYMD: ymd.optional().default(''),
  assignTo: z.string().optional(), // user id — present when delegating
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  notes: z.string().max(2000).optional(),
  dueYMD: ymd.optional(),
});

export const statusSchema = z.object({ status: z.enum(['PENDING', 'DONE']) });

export const listTasksQuerySchema = z.object({
  scope: z.enum(['mine', 'assigned']).optional(),
  status: z.enum(['PENDING', 'DONE']).optional(),
  search: z.string().optional(),
  period: z.enum(['all', 'week', 'month', 'year']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(10000).optional(),
});
