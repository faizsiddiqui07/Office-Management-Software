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
    if (!ensureConfigured()) return;
    const subs = await PushSubscription.find({ user: userId });
    if (!subs.length) return;
    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body);
        } catch (err) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await PushSubscription.deleteOne({ _id: s._id });
          }
        }
      }),
    );
  } catch (err) {
    console.error('sendPush failed:', err?.message);
  }
}
