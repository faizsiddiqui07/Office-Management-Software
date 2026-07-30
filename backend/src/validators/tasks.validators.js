import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').or(z.literal(''));
// A person's id. Checked here rather than left to reach Mongo, where a malformed one
// throws a cast error with no status and surfaces as a 500 on what is really bad input.
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Not a valid person');

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Add the work').max(300),
  notes: z.string().max(2000).optional().default(''),
  dueYMD: ymd.optional().default(''),
  // One id (single delegate) OR a list — assigning the same work to several people
  // at once creates one independent task each.
  assignTo: z.union([objectId, z.array(objectId).max(50)]).optional(),
  collaborators: z.array(objectId).max(20).optional(), // tagged teammates on a shared task
  requiresApproval: z.boolean().optional(), // assigner must approve before it's done
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  notes: z.string().max(2000).optional(),
  dueYMD: ymd.optional(),
  collaborators: z.array(objectId).max(20).optional(), // retag: the owner of a personal task, or the assigner of a delegated one
  applyToAll: z.boolean().optional(), // assigner: push a content edit to every copy of a multi-assigned task
  assignTo: z.union([objectId, z.array(objectId).max(50)]).optional(), // assigner: change who it's assigned to
  requiresApproval: z.boolean().optional(),
});

export const statusSchema = z.object({ status: z.enum(['PENDING', 'DONE']) });

// Read receipts for a whole screenful at once. The ids come from a list the client
// just rendered, so a malformed one is a bug rather than an attack — but unchecked it
// reaches Mongo as a cast error and turns a silent background call into a 500. The cap
// matches the list endpoint's own limit so a full to-do is never quietly truncated.
export const seenBulkSchema = z.object({
  ids: z.array(z.string().regex(/^[a-f\d]{24}$/i, 'Not a task id')).max(10000).optional().default([]),
});

export const forwardTaskSchema = z.object({
  assignTo: objectId,
  requiresApproval: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

export const reviewTaskSchema = z.object({
  approve: z.boolean(),
  reason: z.string().max(1000).optional().default(''),
});

export const listTasksQuerySchema = z.object({
  scope: z.enum(['mine', 'assigned']).optional(),
  status: z.enum(['PENDING', 'DONE']).optional(),
  search: z.string().optional(),
  // Backward-looking presets go with `added`/`completed`; the forward-looking ones and
  // `overdue` go with `due`. The client offers only the set that fits the active tab.
  period: z.enum(['all', 'week', 'month', 'year', 'overdue', 'next7', 'next30']).optional(),
  // Custom date range (overrides `period` when both are given). YMD strings.
  from: ymd.optional(),
  to: ymd.optional(),
  // WHICH date the range means. Omitted = the old implicit rule (completed work by
  // completion, everything else by creation).
  dateBasis: z.enum(['due', 'added', 'completed']).optional(),
  // Just the submissions waiting on me to approve — exempt from the date filter.
  awaiting: z.enum(['1', 'true']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(10000).optional(),
});
