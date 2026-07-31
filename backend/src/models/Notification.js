import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, default: 'INFO' },
    title: { type: String, required: true },
    message: { type: String, default: '' },
    link: { type: String, default: '' },
    isRead: { type: Boolean, default: false },
    // What this notification is ABOUT — so a call-to-action can be withdrawn when the
    // thing it points at goes away. An "approve this" notification is dead the moment
    // the request behind it is cancelled/decided; without a handle on the source it
    // would linger as a link to a queue that no longer holds the item. Set only on the
    // notifications that need clearing (approval requests); left blank otherwise.
    entityType: { type: String, default: '' }, // 'LeaveRequest' | 'Task' | 'Regularization'
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

// Notifications are ephemeral — MongoDB's TTL monitor auto-deletes anything
// older than 30 days, so the collection never grows unbounded.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
// For withdrawing a source's notifications in one sweep (see clearNotificationsFor).
notificationSchema.index({ entityType: 1, entityId: 1 });

notificationSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Notification =
  mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

/** Fire-and-forget notification — never blocks the request. Also web-pushes. */
export async function notify({ user, type = 'INFO', title, message = '', link = '', entityType = '', entityId = null }) {
  try {
    await Notification.create({ user, type, title, message, link, entityType, entityId });
    // Mirror to Web Push (best-effort; no-op if push isn't configured/subscribed).
    import('../lib/push.js')
      .then(({ sendPush }) => sendPush(user, { title, body: message, link, type }))
      .catch(() => {});
  } catch (err) {
    console.error('notify failed:', err?.message);
  }
}

/**
 * Withdraw the notifications raised for one source — e.g. every approver's "approve
 * this" once the request behind it is cancelled, deleted or decided, so the call to
 * action doesn't outlive the thing it points at. Fire-and-forget like notify(): a
 * cleanup hiccup must never fail the cancel/decide it follows.
 *
 * @param {string} entityType  e.g. 'LeaveRequest'
 * @param {any}    entityId    the source document's _id
 * @param {{ types?: string[] }} [opts]  restrict to these notification types
 */
export async function clearNotificationsFor(entityType, entityId, { types } = {}) {
  if (!entityType || !entityId) return;
  try {
    const query = { entityType, entityId };
    if (types && types.length) query.type = { $in: types };
    await Notification.deleteMany(query);
  } catch (err) {
    console.error('clearNotificationsFor failed:', err?.message);
  }
}
