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

/**
 * Raise a notification: the in-app bell row, and the phone's Web Push.
 *
 * The push is AWAITED (with a short cap). It used to be left floating —
 *   import('../lib/push.js').then(({ sendPush }) => sendPush(...)).catch(() => {});
 * — which worked locally and silently did nothing on Lambda. backend/src/lambda.js sets
 * `context.callbackWaitsForEmptyEventLoop = false` (it has to, or every request waits for
 * the Mongo pool to idle), so the execution environment is FROZEN the moment the handler
 * resolves. A promise that was merely started gets frozen mid-flight: it may thaw on some
 * later invocation of the same container, or die with it. Result: the bell row appeared
 * (that create WAS awaited) and the phone stayed silent. Owner's report, 27 Oct 2026.
 *
 * Every caller already awaits notify() — directly or inside an awaited Promise.all — so
 * awaiting here carries all the way up to the route handler, and the push goes out before
 * the response does.
 *
 * Still best-effort in every other way: a push that fails, or a provider that hangs, must
 * never fail or stall the action behind it. sendPush swallows its own errors; PUSH_WAIT_MS
 * caps how long we will wait for it.
 */
const PUSH_WAIT_MS = 3000;

export async function notify({ user, type = 'INFO', title, message = '', link = '', entityType = '', entityId = null }) {
  try {
    await Notification.create({ user, type, title, message, link, entityType, entityId });
    const { sendPush } = await import('../lib/push.js');
    /**
     * `tag` + `renotify` — isi ne SABSE ZYADA notifications chupchap kha li thiN.
     *
     * Service worker (website/public/sw.js) `tag: data.type` lagata tha aur
     * `renotify: data.renotify === true`. notify() `renotify` bhejta hi nahi tha, aur
     * `type` sirf shreni hai — 'TASK_ASSIGNED', 'LEAVE_DECIDED', 'INFO'. Matlab USI
     * shreni ka har agla notification pichhle ko CHUPCHAP badal deta tha: na banner, na
     * awaaz, na buzz (tag se replace karna default me khamosh hota hai). Teen logon ne
     * kaam diya to phone ek hi baar baja — pehli baar — aur baaki dono chupchap swap ho
     * gaye. Owner ki "notification nahi aa rahi" wali shikayat ka bada hissa yahi hai.
     *
     * Ab:
     *  - `tag` apna hai, `type` se alag: ek hi CHEEZ (entity) ke baare me dobara khabar
     *    ho to wahi notification badle (jaise "approve karo" dobara), warna har khabar
     *    apni jagah dikhe — ek doosre ko na mitaye.
     *  - `renotify: true` hamesha: badalne par bhi phone bajta hai. Ye purane service
     *    worker par bhi kaam karta hai (wo pehle se `data.renotify` dekhta hai), isliye
     *    jin phone me SW abhi update nahi hua wahan bhi aaj hi farak padega.
     * Chat apna alag hisaab rakhta hai (chatPush.service.js) — wo khud `renotify` bhejta
     * hai taaki ek hi chat ke das message par das ghantiyan na bajein. Use chhua nahi.
     */
    const tag = entityType && entityId ? `${entityType}:${entityId}` : `n:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await Promise.race([
      sendPush(user, { title, body: message, link, type, tag, renotify: true }),
      new Promise((resolve) => { setTimeout(resolve, PUSH_WAIT_MS).unref?.(); }),
    ]);
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
