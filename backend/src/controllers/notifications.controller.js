import { ok } from '../lib/apiResponse.js';
import { Notification } from '../models/Notification.js';

export async function listNotifications(req, res, next) {
  try {
    const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
    const unread = await Notification.countDocuments({ user: req.user._id, isRead: false });
    res.json(ok({ notifications: notifications.map((n) => n.toJSON()), unread }));
  } catch (err) {
    next(err);
  }
}

export async function markRead(req, res, next) {
  try {
    await Notification.updateOne({ _id: req.params.id, user: req.user._id }, { $set: { isRead: true } });
    res.json(ok({ success: true }));
  } catch (err) {
    next(err);
  }
}

export async function markAllRead(req, res, next) {
  try {
    await Notification.updateMany({ user: req.user._id, isRead: false }, { $set: { isRead: true } });
    res.json(ok({ success: true }));
  } catch (err) {
    next(err);
  }
}
