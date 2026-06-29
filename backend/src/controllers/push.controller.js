import { ok } from '../lib/apiResponse.js';
import { vapidPublicKey, saveSubscription, removeSubscription } from '../lib/push.js';

export function publicKey(_req, res) {
  res.json(ok({ key: vapidPublicKey() }));
}

export async function subscribe(req, res, next) {
  try {
    await saveSubscription(req.user._id, req.body?.subscription, req.headers['user-agent']);
    res.status(201).json(ok({ success: true }));
  } catch (err) {
    next(err);
  }
}

export async function unsubscribe(req, res, next) {
  try {
    await removeSubscription(req.body?.endpoint);
    res.json(ok({ success: true }));
  } catch (err) {
    next(err);
  }
}
