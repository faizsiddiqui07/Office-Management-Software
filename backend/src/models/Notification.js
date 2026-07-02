import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, default: 'INFO' },
    title: { type: String, required: true },
    message: { type: String, default: '' },
    link: { type: String, default: '' },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Notifications are ephemeral — MongoDB's TTL monitor auto-deletes anything
// older than 30 days, so the collection never grows unbounded.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

notificationSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Notification =
  mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

/** Fire-and-forget notification — never blocks the request. Also web-pushes. */
export async function notify({ user, type = 'INFO', title, message = '', link = '' }) {
  try {
    await Notification.create({ user, type, title, message, link });
    // Mirror to Web Push (best-effort; no-op if push isn't configured/subscribed).
    import('../lib/push.js')
      .then(({ sendPush }) => sendPush(user, { title, body: message, link, type }))
      .catch(() => {});
  } catch (err) {
    console.error('notify failed:', err?.message);
  }
}
