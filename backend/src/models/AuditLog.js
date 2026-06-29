import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    entityType: { type: String, default: '' },
    entityId: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', schema);

/** Fire-and-forget audit helper — never blocks the request on a logging failure. */
export async function audit({ actor, action, entityType, entityId, meta }) {
  try {
    await AuditLog.create({ actor: actor ?? null, action, entityType, entityId, meta });
  } catch (err) {
    console.error('Audit log failed:', err?.message);
  }
}
