import webpush from 'web-push';
import { PushSubscription } from '../models/PushSubscription.js';

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export async function saveSubscription(userId, sub, userAgent) {
  if (!sub?.endpoint) return null;
  return PushSubscription.findOneAndUpdate(
    { endpoint: sub.endpoint },
    { $set: { user: userId, endpoint: sub.endpoint, keys: sub.keys || {}, userAgent: userAgent || '' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function removeSubscription(endpoint) {
  if (!endpoint) return;
  await PushSubscription.deleteOne({ endpoint });
}

/**
 * Fire-and-forget Web Push to all of a user's devices. Silently prunes
 * subscriptions the browser has expired (404/410). Never throws.
 */
export async function sendPush(userId, payload) {
  try {
    // Ye teen raaste CHUPCHAP lautte the — ek bhi log line nahi. Isi wajah se "phone par
    // notification nahi aa rahi" ki wajah bahar se jaani hi nahi ja sakti thi: VAPID
    // chaabi Lambda par lagi hai ya nahi, bande ka koi device juda hai ya nahi, aur push
    // service ne kya kaha — CloudWatch me kuch bhi nahi hota tha. Ab har haalat ek line
    // chhodti hai. (Message ka matn kabhi log me nahi jaata.)
    if (!ensureConfigured()) {
      console.warn('push: VAPID keys not set — nothing will reach any phone');
      return;
    }
    const subs = await PushSubscription.find({ user: userId });
    if (!subs.length) {
      console.log(`push: no device registered for ${userId}`);
      return;
    }
    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body);
        } catch (err) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            console.log(`push: endpoint gone (${err.statusCode}), dropping it for ${userId}`);
            await PushSubscription.deleteOne({ _id: s._id });
          } else {
            console.error(`push: send failed for ${userId} — ${err?.statusCode || '?'} ${err?.message}`);
          }
        }
      }),
    );
  } catch (err) {
    console.error('sendPush failed:', err?.message);
  }
}
