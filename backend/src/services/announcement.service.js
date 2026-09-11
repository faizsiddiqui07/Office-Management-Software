import { Announcement } from '../models/Announcement.js';
import { AnnouncementRead } from '../models/AnnouncementRead.js';
import { User } from '../models/User.js';
import { notify } from '../models/Notification.js';
import { can } from '../lib/permissions.js';
import { ymdInTz, companyDayFromYMD, companyDayInstantAt } from '../lib/time.js';
import { matchesYMD, nextOccurrenceYMD, lastOccurrenceOnOrBefore, normalizeRule } from '../lib/recurrence.js';

/** The instant 'HH:mm' falls on a given company day — through the zone-aware helper, so
 *  it stays right even if COMPANY_TZ is ever pointed at a zone with DST. */
const atCompanyTime = (ymd, hhmm) => companyDayInstantAt(companyDayFromYMD(ymd), hhmm || '09:00');
const ruleOf = (doc) => (doc?.recurrence?.type ? doc.recurrence : { type: 'NONE' });
const isRecurring = (doc) => ruleOf(doc).type !== 'NONE';
/** Is this post out where people can see it right now? notifiedAt alone is not the
 *  test: rows from before that field existed have none and were visible all along. */
const isOut = (doc, now) => !!doc.notifiedAt || !doc.publishAt || doc.publishAt.getTime() <= now.getTime();

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
async function notifyAudience(doc, excludeUserId, { repeat = false } = {}) {
  const roleFilter = doc.audienceRoles?.length ? { role: { $in: doc.audienceRoles } } : {};
  const recipients = await User.find({ isActive: true, ...roleFilter, ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {}) }).select('_id');
  await Promise.all(
    recipients.map((u) =>
      notify({
        user: u._id,
        type: 'ANNOUNCEMENT',
        // A repeat is not "new" — saying so every Saturday would teach people the word
        // means nothing.
        title: `${repeat ? 'Announcement' : 'New announcement'}: ${doc.title}`,
        message: doc.priority === 'URGENT' ? 'Marked urgent' : '',
        link: '/announcements',
      }),
    ),
  );
}

/**
 * Announce anything whose scheduled time has arrived. Runs from the EventBridge
 * schedule every few minutes, and from feed reads as a fallback; claims each one with a stamped
 * `notifiedAt` before sending, so two instances doing this at once can't both announce
 * the same post. Best-effort: a failure here must never break the feed.
 */
export async function publishDueAnnouncements(now = new Date()) {
  // The feed sorts on announcedAt now. Rows from before it existed get theirs filled in
  // from the moment they were announced (or created) — once, and then this matches
  // nothing and costs nothing.
  await Announcement.updateMany(
    { announcedAt: null },
    [{ $set: { announcedAt: { $ifNull: ['$notifiedAt', '$createdAt'] } } }],
  );
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
      { $set: { notifiedAt: now, announcedAt: now }, $push: { occurrences: { $each: [ymdInTz(now)], $slice: -200 } } },
    );
    // eslint-disable-next-line no-await-in-loop
    if (claimed) await notifyAudience(a, a.createdBy);
  }
}

/**
 * Re-announce anything that repeats and is due again today.
 *
 * Runs from the scheduler every few minutes. A repeating post goes out again on each day
 * its rule falls on, once the clock reaches its time — and only once: the day is CLAIMED
 * by writing it to lastRecurredYMD before anything is sent, so two instances seeing the
 * same tick cannot both send. Going out again means: the read receipts are wiped (so it
 * pops up for everyone as unseen, and the author's "seen 3 of 12" starts over for this
 * occurrence), announcedAt moves to now (so it rises to the top of the feed), and the
 * audience gets the bell.
 *
 * Only posts whose FIRST announcement has already happened are considered. A repeating
 * post created ahead of its first day is a scheduled post until then, and
 * publishDueAnnouncements owns that moment; lastRecurredYMD is pre-set to that first day
 * at creation so this scanner cannot fire it a second time on the same day.
 */
export async function announceRecurring(now = new Date()) {
  const today = ymdInTz(now);
  const candidates = await Announcement.find({
    isActive: true,
    'recurrence.type': { $in: ['WEEKLY', 'MONTHLY', 'YEARLY'] },
    notifiedAt: { $ne: null },
    lastRecurredYMD: { $ne: today },
    // A future publishAt hides the post from the feed; announcing it while hidden would
    // send a bell to a post that shows nothing when tapped.
    $and: [
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
      { $or: [{ publishAt: null }, { publishAt: { $lte: now } }] },
    ],
  }).select('_id title priority audienceRoles createdBy recurrence lastRecurredYMD');

  for (const a of candidates) {
    const rule = ruleOf(a);
    // The occurrence to announce is the most recent one on or before today that has not
    // already gone out — today if today falls on the rule and its time has passed, else
    // YESTERDAY if that did and was missed (its time fell in the gap between two ticks,
    // or the last tick of the day came before it). Nothing older: a scanner that was
    // down for a week does not get to announce a week of stale reminders on Monday.
    const due = lastOccurrenceOnOrBefore(rule, today, 1);
    if (!due || due <= (a.lastRecurredYMD || '')) continue;
    if (due === today && now < atCompanyTime(today, rule.time)) continue; // its hour hasn't come yet
    // eslint-disable-next-line no-await-in-loop
    const claimed = await Announcement.findOneAndUpdate(
      { _id: a._id, lastRecurredYMD: { $ne: due } },
      { $set: { lastRecurredYMD: due, announcedAt: now }, $push: { occurrences: { $each: [due], $slice: -200 } } },
    );
    if (!claimed) continue;
    // eslint-disable-next-line no-await-in-loop
    await AnnouncementRead.deleteMany({ announcement: a._id });
    // eslint-disable-next-line no-await-in-loop
    await notifyAudience(a, a.createdBy, { repeat: true });
  }
}

export async function createAnnouncement(creator, data, now = new Date()) {
  const rule = normalizeRule(data.recurrence);
  let publishAt = data.publishAt ? new Date(data.publishAt) : null;
  let lastRecurredYMD = '';
  if (rule.type !== 'NONE') {
    // A repeating post's first outing is the first day its rule falls on, at its time —
    // today included. If that moment is still ahead it is a scheduled post until then;
    // if it has already passed today, the person plainly wants it out now. Either way
    // the day is stamped as claimed, so the repeat scanner never doubles the first one.
    const today = ymdInTz(now);
    const first = nextOccurrenceYMD(rule, today);
    const firstAt = atCompanyTime(first, rule.time);
    publishAt = firstAt.getTime() > now.getTime() ? firstAt : null;
    lastRecurredYMD = first;
  }
  const doc = await Announcement.create({
    title: data.title,
    body: data.body || '',
    priority: data.priority || 'NORMAL',
    audienceRoles: data.audienceRoles || [],
    createdBy: creator._id,
    publishAt,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    isActive: true,
    recurrence: rule,
    lastRecurredYMD,
  });

  // Notify the audience — but only for something they can actually go and read.
  // An announcement scheduled for later is hidden from the feed until its time
  // (see visibilityFilter), so announcing it now sent a bell and a phone notification
  // for a post that showed nothing when tapped. A scheduled one announces itself when
  // it goes live instead (see publishDueAnnouncements).
  const scheduled = doc.publishAt && doc.publishAt.getTime() > now.getTime();
  if (!scheduled) {
    doc.notifiedAt = now; // already announced — publishDueAnnouncements skips it
    doc.announcedAt = doc.notifiedAt;
    if (rule.type !== 'NONE') doc.occurrences = [ymdInTz(now)];
    await doc.save();
    await notifyAudience(doc, creator._id);
  }

  await doc.populate('createdBy', 'name role');
  return doc.toJSON();
}

export async function listVisible(user, now = new Date()) {
  // Anything scheduled that has come due announces itself here too — the scheduler is
  // the main path, but a feed load is a free second chance at it.
  try {
    await publishDueAnnouncements(now);
  } catch (e) {
    console.error('scheduled announcement publish failed', e?.message);
  }
  // Newest OUTING first, not newest creation: a repeating post that went out again this
  // morning belongs at the top, however long ago it was written.
  // Somebody who can post sees the posts they have SCHEDULED too — marked, and only their
  // own. Without this a repeating post created on a Wednesday for "every Saturday" showed
  // "Announcement posted" and then vanished until Saturday, with no way to see it, edit
  // it or take it back in between.
  const canPost = can(user, 'postAnnouncements');
  const filter = canPost
    ? { $or: [visibilityFilter(user.role, now), { isActive: true, createdBy: user._id, publishAt: { $gt: now } }] }
    : visibilityFilter(user.role, now);
  const anns = await Announcement.find(filter)
    .sort({ announcedAt: -1, createdAt: -1 })
    .limit(100)
    .populate('createdBy', 'name role');
  const out = anns.map((a) => {
    const j = a.toJSON();
    if (a.publishAt && a.publishAt.getTime() > now.getTime()) j.scheduledFor = a.publishAt;
    return j;
  });

  // SP2: for someone who can post, attach a "seen X of Y" roll-up to every card so the
  // feed shows it at a glance. Computed in TWO batched queries total — replacing the old
  // N+1 where each card fired its own /reads request (V15). Counted EXACTLY the way
  // readReceipts does (active users the roles address, minus the author) so the chip and
  // the who-saw-it popup can never disagree.
  if (canPost && anns.length) {
    const ids = anns.map((a) => a._id);
    const [activeUsers, reads] = await Promise.all([
      User.find({ isActive: true }).select('_id role'),
      AnnouncementRead.find({ announcement: { $in: ids } }).select('announcement user'),
    ]);
    const readersByAnn = new Map();
    for (const r of reads) {
      const k = String(r.announcement);
      if (!readersByAnn.has(k)) readersByAnn.set(k, new Set());
      readersByAnn.get(k).add(String(r.user));
    }
    anns.forEach((a, i) => {
      const roles = a.audienceRoles || [];
      const authorId = String(a.createdBy?._id || a.createdBy);
      const audience = activeUsers.filter((u) => (roles.length === 0 || roles.includes(u.role)) && String(u._id) !== authorId);
      const readers = readersByAnn.get(String(a._id)) || new Set();
      const seenCount = audience.reduce((n, u) => n + (readers.has(String(u._id)) ? 1 : 0), 0);
      out[i].reads = { seenCount, total: audience.length };
    });
  }
  return out;
}

export async function activeUnseen(user, now = new Date()) {
  const visible = await Announcement.find(visibilityFilter(user.role, now))
    .sort({ announcedAt: -1, createdAt: -1 })
    .populate('createdBy', 'name role');

  if (!visible.length) return [];
  const reads = await AnnouncementRead.find({
    user: user._id,
    announcement: { $in: visible.map((a) => a._id) },
  }).select('announcement');
  const seen = new Set(reads.map((r) => String(r.announcement)));

  return visible.filter((a) => !seen.has(String(a._id))).map((a) => a.toJSON());
}

/**
 * Who has (and hasn't) seen an announcement — for the author to chase the stragglers.
 * The audience is the active users its roles address (everyone if unrestricted), minus
 * the author, who obviously knows about their own post. Reads come from AnnouncementRead
 * (written when a person pages through the popup).
 */
export async function readReceipts(announcementId) {
  const ann = await Announcement.findById(announcementId).select('audienceRoles createdBy');
  if (!ann) throw httpError(404, 'NOT_FOUND', 'Announcement not found');

  const roleFilter = ann.audienceRoles?.length ? { role: { $in: ann.audienceRoles } } : {};
  const [audience, reads] = await Promise.all([
    User.find({ isActive: true, ...roleFilter, _id: { $ne: ann.createdBy } }).select('name role').sort({ name: 1 }),
    AnnouncementRead.find({ announcement: announcementId }).select('user readAt'),
  ]);

  const readAtByUser = new Map(reads.map((r) => [String(r.user), r.readAt]));
  const seen = [];
  const unseen = [];
  for (const u of audience) {
    const at = readAtByUser.get(String(u._id));
    if (at) seen.push({ name: u.name, readAt: at });
    else unseen.push({ name: u.name });
  }
  // Most-recent readers first; unseen already alphabetical from the sorted query.
  seen.sort((a, b) => new Date(b.readAt) - new Date(a.readAt));
  return { total: audience.length, seenCount: seen.length, seen, unseen };
}

export async function markRead(user, announcementId) {
  await AnnouncementRead.findOneAndUpdate(
    { announcement: announcementId, user: user._id },
    { $set: { readAt: new Date() }, $setOnInsert: { announcement: announcementId, user: user._id } },
    { upsert: true, new: true },
  );
}

export async function updateAnnouncement(id, data, now = new Date()) {
  const ann = await Announcement.findById(id);
  if (!ann) throw httpError(404, 'NOT_FOUND', 'Announcement not found');
  const fields = ['title', 'body', 'priority', 'audienceRoles'];
  for (const f of fields) if (data[f] !== undefined) ann[f] = data[f];
  if (data.publishAt !== undefined) ann.publishAt = data.publishAt ? new Date(data.publishAt) : null;
  if (data.expiresAt !== undefined) ann.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
  let announceNow = false;
  if (data.recurrence !== undefined) {
    const rule = normalizeRule(data.recurrence);
    const was = isRecurring(ann);
    const out = isOut(ann, now);
    const today = ymdInTz(now);
    ann.recurrence = rule;
    if (rule.type === 'NONE') {
      ann.lastRecurredYMD = '';
      if (was && !out) {
        // The schedule was DERIVED from the rule; with the rule gone it is a plain post,
        // and a plain post goes out now rather than sitting hidden until a first-Saturday
        // that no longer means anything.
        ann.publishAt = null;
        announceNow = true;
      }
    } else if (out) {
      if (!was) {
        // Already out. Anchor on the day it last went out, so any matching day after
        // that fires — today included — while that day cannot fire a second time.
        ann.lastRecurredYMD = ymdInTz(ann.announcedAt || ann.notifiedAt || ann.createdAt);
        // Rows from before notifiedAt existed have none; the scanner keys on it, so a
        // repeat added to one of those would never fire. Stamp what is already true.
        if (!ann.notifiedAt) ann.notifiedAt = ann.announcedAt || ann.createdAt;
        if (!ann.announcedAt) ann.announcedAt = ann.notifiedAt;
      }
      // Rule changed on a post that is out: the stamp is kept, so a day that already
      // went out under the old rule cannot go out again under the new one.
    } else {
      // Not out yet, so the schedule follows the rule — whether the rule is being added
      // or changed. Keeping the old first day here was the bug: "every Saturday" edited
      // to "every Monday" before it ever went out still went out on the Saturday.
      const first = nextOccurrenceYMD(rule, today);
      ann.publishAt = atCompanyTime(first, rule.time);
      ann.lastRecurredYMD = first;
    }
  }
  await ann.save();
  if (announceNow) {
    // Same path createAnnouncement takes for an immediate post.
    ann.notifiedAt = now;
    ann.announcedAt = now;
    await ann.save();
    await notifyAudience(ann, ann.createdBy);
  }
  await ann.populate('createdBy', 'name role');
  return ann.toJSON();
}

export async function retireAnnouncement(id) {
  const ann = await Announcement.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true });
  if (!ann) throw httpError(404, 'NOT_FOUND', 'Announcement not found');
  return ann.toJSON();
}
