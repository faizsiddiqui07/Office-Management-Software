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

/** Bell + push to everyone the announcement is addressed to, except its author. */
async function notifyAudience(doc, excludeUserId) {
  const roleFilter = doc.audienceRoles?.length ? { role: { $in: doc.audienceRoles } } : {};
  const recipients = await User.find({ isActive: true, ...roleFilter, ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {}) }).select('_id');
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
}

/**
 * Announce anything whose scheduled time has arrived. Runs off ordinary reads rather
 * than a timer (there's no scheduler on Lambda), and claims each one with a stamped
 * `notifiedAt` before sending, so two instances doing this at once can't both announce
 * the same post. Best-effort: a failure here must never break the feed.
 */
export async function publishDueAnnouncements() {
  const now = new Date();
  const due = await Announcement.find({
    isActive: true,
    notifiedAt: null,
    publishAt: { $ne: null, $lte: now },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  }).select('_id title priority audienceRoles createdBy').limit(20);

  for (const a of due) {
    // Claim it first — only the instance whose update matches gets to send.
    // eslint-disable-next-line no-await-in-loop
    const claimed = await Announcement.findOneAndUpdate(
      { _id: a._id, notifiedAt: null },
      { $set: { notifiedAt: now } },
    );
    // eslint-disable-next-line no-await-in-loop
    if (claimed) await notifyAudience(a, a.createdBy);
  }
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

  // Notify the audience — but only for something they can actually go and read.
  // An announcement scheduled for later is hidden from the feed until its time
  // (see visibilityFilter), so announcing it now sent a bell and a phone notification
  // for a post that showed nothing when tapped. A scheduled one announces itself when
  // it goes live instead (see publishDueAnnouncements).
  const scheduled = doc.publishAt && doc.publishAt.getTime() > Date.now();
  if (!scheduled) {
    doc.notifiedAt = new Date(); // already announced — publishDueAnnouncements skips it
    await doc.save();
    await notifyAudience(doc, creator._id);
  }

  await doc.populate('createdBy', 'name role');
  return doc.toJSON();
}

export async function listVisible(user) {
  // Anything scheduled that has come due announces itself here — this runs on every
  // dashboard and announcements load, which is as close to a timer as Lambda gets.
  try {
    await publishDueAnnouncements();
  } catch (e) {
    console.error('scheduled announcement publish failed', e?.message);
  }
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
