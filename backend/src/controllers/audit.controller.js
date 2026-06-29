import { z } from 'zod';
import { ok } from '../lib/apiResponse.js';
import { AuditLog } from '../models/AuditLog.js';

const querySchema = z.object({
  action: z.string().optional(),
  entityType: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function listAudit(req, res, next) {
  try {
    const q = querySchema.parse(req.query);
    const filter = {};
    if (q.action) filter.action = new RegExp(`^${q.action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (q.entityType) filter.entityType = q.entityType;
    if (q.from || q.to) {
      filter.createdAt = {};
      if (q.from) filter.createdAt.$gte = new Date(`${q.from}T00:00:00`);
      if (q.to) filter.createdAt.$lte = new Date(`${q.to}T23:59:59`);
    }

    const page = q.page || 1;
    const limit = q.limit || 30;
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('actor', 'name role'),
      AuditLog.countDocuments(filter),
    ]);

    res.json(
      ok({
        logs: logs.map((l) => ({
          id: l.id,
          action: l.action,
          actor: l.actor?.name ?? 'System',
          actorRole: l.actor?.role ?? null,
          entityType: l.entityType,
          entityId: l.entityId,
          meta: l.meta,
          createdAt: l.createdAt,
        })),
        total,
        page,
        limit,
      }),
    );
  } catch (err) {
    next(err);
  }
}
