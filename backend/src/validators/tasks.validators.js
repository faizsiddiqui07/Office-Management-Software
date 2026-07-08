import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').or(z.literal(''));

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Add the work').max(300),
  notes: z.string().max(2000).optional().default(''),
  dueYMD: ymd.optional().default(''),
  // One id (single delegate) OR a list — assigning the same work to several people
  // at once creates one independent task each.
  assignTo: z.union([z.string(), z.array(z.string()).max(50)]).optional(),
  collaborators: z.array(z.string()).max(20).optional(), // tagged teammates on a shared task
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  notes: z.string().max(2000).optional(),
  dueYMD: ymd.optional(),
  collaborators: z.array(z.string()).max(20).optional(), // owner can retag a shared task
  applyToAll: z.boolean().optional(), // assigner: push a content edit to every copy of a multi-assigned task
});

export const statusSchema = z.object({ status: z.enum(['PENDING', 'DONE']) });

export const listTasksQuerySchema = z.object({
  scope: z.enum(['mine', 'assigned']).optional(),
  status: z.enum(['PENDING', 'DONE']).optional(),
  search: z.string().optional(),
  period: z.enum(['all', 'week', 'month', 'year']).optional(),
  // Custom date range (overrides `period` when both are given). YMD strings.
  from: ymd.optional(),
  to: ymd.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(10000).optional(),
});
