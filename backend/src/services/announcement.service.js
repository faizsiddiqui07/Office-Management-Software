import { Announcement } from '../models/Announcement.js';
import { AnnouncementRead } from '../models/AnnouncementRead.js';
import { User } from '../models/User.js';
import { notify } from '../models/Notification.js';

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/** Mongo filter for announcements visible to `role` right now. */
function visibilityFilter(role, now = new Date()) {
  return {
    isActive: true,
    $and: [
      { $or: [{ audienceRoles: { $size: 0 } }, { audienceRoles: role }] },
      { $or: [{ publishAt: null }, { publishAt: { $lte: now } }] },
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
    ],
  };
}

export async function createAnnouncement(creator, data) {
  const doc = await Announcement.create({
    title: data.title,
    body: data.body || '',
    priority: data.priority || 'NORMAL',
    audienceRoles: data.audienceRoles || [],
    createdBy: creator._id,
    publishAt: data.publishAt ? new Date(data.publishAt) : null,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    isActive: true,
  });

  // Notify the audience.
  const roleFilter = doc.audienceRoles.length ? { role: { $in: doc.audienceRoles } } : {};
  const recipients = await User.find({ isActive: true, ...roleFilter, _id: { $ne: creator._id } }).select('_id');
  await Promise.all(
    recipients.map((u) =>
      notify({
        user: u._id,
        type: 'ANNOUNCEMENT',
        title: `New announcement: ${doc.title}`,
        message: doc.priority === 'URGENT' ? 'Marked urgent' : '',
        link: '/announcements',
      }),
    ),
  );

  await doc.populate('createdBy', 'name role');
  return doc.toJSON();
}

export async function listVisible(user) {
  const anns = await Announcement.find(visibilityFilter(user.role))
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('createdBy', 'name role');
  return anns.map((a) => a.toJSON());
}

export async function activeUnseen(user) {
  const visible = await Announcement.find(visibilityFilter(user.role))
    .sort({ createdAt: -1 })
    .populate('createdBy', 'name role');

  if (!visible.length) return [];
  const reads = await AnnouncementRead.find({
    user: user._id,
    announcement: { $in: visible.map((a) => a._id) },
  }).select('announcement');
  const seen = new Set(reads.map((r) => String(r.announcement)));

  return visible.filter((a) => !seen.has(String(a._id))).map((a) => a.toJSON());
}

export async function markRead(user, announcementId) {
  await AnnouncementRead.findOneAndUpdate(
    { announcement: announcementId, user: user._id },
    { $set: { readAt: new Date() }, $setOnInsert: { announcement: announcementId, user: user._id } },
    { upsert: true, new: true },
  );
}

export async function updateAnnouncement(id, data) {
  const ann = await Announcement.findById(id);
  if (!ann) throw httpError(404, 'NOT_FOUND', 'Announcement not found');
  const fields = ['title', 'body', 'priority', 'audienceRoles'];
  for (const f of fields) if (data[f] !== undefined) ann[f] = data[f];
  if (data.publishAt !== undefined) ann.publishAt = data.publishAt ? new Date(data.publishAt) : null;
  if (data.expiresAt !== undefined) ann.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
  await ann.save();
  await ann.populate('createdBy', 'name role');
  return ann.toJSON();
}

export async function retireAnnouncement(id) {
  const ann = await Announcement.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true });
  if (!ann) throw httpError(404, 'NOT_FOUND', 'Announcement not found');
  return ann.toJSON();
}
