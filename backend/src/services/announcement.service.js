import mongoose from 'mongoose';
import { Announcement } from '../models/Announcement.js';
import { AnnouncementRead } from '../models/AnnouncementRead.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { notify, clearNotificationsFor } from '../models/Notification.js';
import { can } from '../lib/permissions.js';
import { ensureRolesFresh, roleExists, roleLabel } from '../lib/roles.js';
import { ymdInTz, companyDayFromYMD, companyDayInstantAt } from '../lib/time.js';
import { matchesYMD, nextOccurrenceYMD, lastOccurrenceOnOrBefore, normalizeRule, prevDay } from '../lib/recurrence.js';

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
function visibilityFilter(user, now = new Date()) {
  const viewerId = user?._id || user?.id || null;
  // The three "addressed to" branches are a UNION on purpose. A row carrying both lists is
  // only reachable by a hand edit (the service clears one when the other is set), and showing
  // it to the union is the safe direction to fail in — showing it to nobody is not.
  const addressed = [
    {
      // BOTH halves need $exists as well as $size. Every announcement written before
      // audienceUsers existed has no such key in Mongo at all, and $size:0 does not match a
      // missing field — testing only the size would have hidden every old post from everyone,
      // silently, with an empty feed and nothing in the logs.
      $and: [
        { $or: [{ audienceRoles: { $exists: false } }, { audienceRoles: { $size: 0 } }] },
        { $or: [{ audienceUsers: { $exists: false } }, { audienceUsers: { $size: 0 } }] },
      ],
    },
    { audienceRoles: user?.role },
  ];
  // Only when there really is an id: mongoose DROPS `{ audienceUsers: undefined }`, leaving
  // `{}` — a branch that matches every row, which would hand every individually-addressed
  // post to whoever reached this without one.
  if (viewerId) addressed.push({ audienceUsers: viewerId });
  return {
    isActive: true,
    $and: [
      { $or: addressed },
      { $or: [{ publishAt: null }, { publishAt: { $lte: now } }] },
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
    ],
  };
}

/**
 * The query for the live people an announcement is addressed to, with one person (normally
 * the author) left out. Returns null when that leaves nobody.
 *
 * Shared by the bell, the "Seen by" list and the feed's seen-count chip, so those three can
 * never disagree about who a post was for.
 *
 * The author is taken out of the ID LIST, never with a second `_id` condition. An object
 * holding both `_id: { $in: [...] }` and `_id: { $ne: x }` keeps only the LAST key — and that
 * one matches every active user, so a post meant for three people would have rung the bell
 * for the whole office.
 */
function audienceUserQuery(doc, excludeUserId) {
  const ex = excludeUserId ? String(excludeUserId) : null;
  const picked = doc.audienceUsers || [];
  if (picked.length) {
    const ids = picked.filter((u) => String(u) !== ex);
    if (!ids.length) return null; // addressed to the author alone
    return { isActive: true, _id: { $in: ids } };
  }
  const q = { isActive: true };
  if (doc.audienceRoles?.length) q.role = { $in: doc.audienceRoles };
  if (ex) q._id = { $ne: excludeUserId };
  return q;
}

/** Bell + push to everyone the announcement is addressed to, except its author. */
async function notifyAudience(doc, excludeUserId, { repeat = false } = {}) {
  const query = audienceUserQuery(doc, excludeUserId);
  if (!query) return; // nobody but the author — no bell to ring
  const recipients = await User.find(query).select('_id');
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
        // Stamped so deleting the announcement can take its bells down with it. Without a
        // handle on the source, deleteAnnouncement had no way to find these and people were
        // left with a notification pointing at a post that no longer exists.
        entityType: 'Announcement',
        entityId: doc._id,
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
  // Rows written before audienceUsers existed have no such key. visibilityFilter already
  // handles that with $exists, so this is belt and braces rather than a dependency — but it
  // means a hand-written query that forgets the $exists half still behaves, and after one
  // pass it matches nothing and costs nothing. Same trick as the line above.
  await Announcement.updateMany({ audienceUsers: { $exists: false } }, { $set: { audienceUsers: [] } });
  const due = await Announcement.find({
    isActive: true,
    notifiedAt: null,
    publishAt: { $ne: null, $lte: now },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    // audienceUsers is NOT optional here: leave it out of the projection and mongoose
    // hands back an empty array, audienceUserQuery reads that as "everyone", and a scheduled
    // post meant for three people goes to the whole office with nothing in the logs.
  }).select('_id title priority audienceRoles audienceUsers createdBy').limit(20);

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
  }).select('_id title priority audienceRoles audienceUsers createdBy recurrence lastRecurredYMD');

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

/**
 * Check the picked audience against the roles that actually exist — here, not in the
 * validator, because roles live in the database and the office renames and adds them while
 * a zod schema is fixed at module load.
 *
 * ensureRolesFresh(key) matters on Lambda: a role created a minute ago on one container is
 * not in THIS container's cache yet, and rejecting a role the person can see on screen is
 * exactly the bug this replaces. An empty list is "everyone" and needs no check.
 */
async function assertAudienceRoles(audienceRoles) {
  const picked = (audienceRoles || []).filter(Boolean);
  if (!picked.length) return;
  const unknown = [];
  for (const key of picked) {
    // eslint-disable-next-line no-await-in-loop
    await ensureRolesFresh(key);
    if (!roleExists(key)) unknown.push(key);
  }
  if (unknown.length) {
    const named = unknown.map((k) => roleLabel(k) || k).join(', ');
    throw httpError(400, 'UNKNOWN_ROLE', `${unknown.length === 1 ? 'This role no longer exists' : 'These roles no longer exist'}: ${named}. Pick the audience again.`);
  }
}

/**
 * Check the picked people against who is actually here — in the service, for the same reason
 * the role check is: a schema can see the SHAPE of an id, never whether that person is still
 * with the office. Returns the ids to store.
 *
 * Whoever has gone is named, not listed as an id — an ObjectId in a toast tells nobody which
 * name to pick again.
 */
async function assertAudienceUsers(audienceUsers) {
  const picked = [...new Set((audienceUsers || []).filter(Boolean).map(String))];
  if (!picked.length) return [];
  // A non-id string makes User.find() throw a CastError, which surfaces as a 500 and
  // "Something went wrong". The validator catches this for HTTP callers; other services call
  // in here directly.
  if (picked.some((id) => !mongoose.isValidObjectId(id))) {
    throw httpError(400, 'UNKNOWN_USER', 'Pick the people from the list again.');
  }
  const live = await User.find({ _id: { $in: picked }, isActive: true }).select('_id');
  if (live.length === picked.length) return live.map((u) => u._id);

  const found = new Set(live.map((u) => String(u._id)));
  const gone = picked.filter((id) => !found.has(id));
  // Looked up WITHOUT isActive, so a deactivated colleague is named rather than reported as a
  // number. Somebody deleted for good has no name left to give, so they are counted instead.
  const named = (await User.find({ _id: { $in: gone } }).select('name')).map((u) => u.name);
  const missing = gone.length - named.length;
  if (missing > 0) named.push(`${missing} removed ${missing === 1 ? 'person' : 'people'}`);
  throw httpError(400, 'UNKNOWN_USER', `${named.join(', ')} ${named.length === 1 ? 'is' : 'are'} no longer here. Pick the audience again.`);
}

export async function createAnnouncement(creator, data, now = new Date()) {
  await assertAudienceRoles(data.audienceRoles);
  const audienceUsers = await assertAudienceUsers(data.audienceUsers);
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
    audienceUsers,
    // The dropdown is a switch, so only one can be in force. Clearing the other HERE rather
    // than working out a precedence at read time means a row never carries a stale audience
    // that some later edit could quietly bring back to life.
    audienceRoles: audienceUsers.length ? [] : (data.audienceRoles || []),
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
    // No publishAt condition on the author's own branch. It used to cover only their
    // SCHEDULED posts, which was enough while every post reached its own author through the
    // role branch — but a post addressed to named people that do not include them is invisible
    // to them, and with it go Edit, Delete and the whole "Seen by" list for something they
    // just wrote.
    ? { $or: [visibilityFilter(user, now), { isActive: true, createdBy: user._id }] }
    : visibilityFilter(user, now);
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
    // Sets, not list scans: 100 cards x 500 people x 20 ids is a million string compares on
    // every feed load.
    const pickedByAnn = new Map();
    for (const a of anns) {
      const picked = a.audienceUsers || [];
      if (picked.length) pickedByAnn.set(String(a._id), new Set(picked.map(String)));
    }
    anns.forEach((a, i) => {
      const roles = a.audienceRoles || [];
      const picked = pickedByAnn.get(String(a._id));
      const authorId = String(a.createdBy?._id || a.createdBy);
      // Exactly the rule audienceUserQuery asks Mongo, so this chip and the who-saw-it popup
      // can never drift apart.
      const audience = activeUsers.filter(
        (u) => (picked ? picked.has(String(u._id)) : roles.length === 0 || roles.includes(u.role))
          && String(u._id) !== authorId,
      );
      const readers = readersByAnn.get(String(a._id)) || new Set();
      const seenCount = audience.reduce((n, u) => n + (readers.has(String(u._id)) ? 1 : 0), 0);
      out[i].reads = { seenCount, total: audience.length };
    });
  }
  return out;
}

export async function activeUnseen(user, now = new Date()) {
  const visible = await Announcement.find(visibilityFilter(user, now))
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
  const ann = await Announcement.findById(announcementId).select('audienceRoles audienceUsers createdBy');
  if (!ann) throw httpError(404, 'NOT_FOUND', 'Announcement not found');

  const query = audienceUserQuery(ann, ann.createdBy);
  const [audience, reads] = await Promise.all([
    query ? User.find(query).select('name role').sort({ name: 1 }) : [],
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

/**
 * Everyone an announcement can be addressed to — the people picker's directory.
 *
 * Deliberately NOT `GET /users`: that is gated on `viewEveryone`, a different permission from
 * the `postAnnouncements` this dialog already requires, so a role allowed to post but not to
 * browse the directory would get a 403 and a blank picker with nothing on screen to explain
 * it. This route carries the same gate as posting, and shows nothing that `/tasks/assignable`
 * does not already show every signed-in person.
 *
 * NO avatarUrl, and that is load-bearing rather than an opinion: avatars are stored as base64
 * data URLs (a 384px JPEG, roughly 35 KB each), so a 500-person list carrying them would be a
 * multi-megabyte response for a dropdown. The picker draws initials instead.
 *
 * The caller is included — they may well want to address something to themselves and a few
 * others. The bell and the "Seen by" count exclude the author on their own.
 */
export async function audiencePeople() {
  const people = await User.find({ isActive: true })
    .select('name role designation')
    .sort({ name: 1 })
    .lean();
  return {
    people: people.map((u) => ({
      id: String(u._id),
      name: u.name,
      role: u.role,
      roleLabel: roleLabel(u.role) || u.role,
      designation: u.designation || '',
    })),
  };
}

export async function markRead(user, announcementId) {
  await AnnouncementRead.findOneAndUpdate(
    { announcement: announcementId, user: user._id },
    { $set: { readAt: new Date() }, $setOnInsert: { announcement: announcementId, user: user._id } },
    { upsert: true, new: true },
  );
}

export async function updateAnnouncement(id, data, now = new Date()) {
  if (data.audienceRoles !== undefined) await assertAudienceRoles(data.audienceRoles);
  const ann = await Announcement.findById(id);
  if (!ann) throw httpError(404, 'NOT_FOUND', 'Announcement not found');
  const fields = ['title', 'body', 'priority'];
  for (const f of fields) if (data[f] !== undefined) ann[f] = data[f];

  // The audience, as two INDEPENDENT blocks. A key the client did not send is a key it did
  // not mean to change — reading an absent one as "empty" would mean an edit that only
  // touched the title silently wiped a whole team off the post. Whichever list arrives
  // non-empty clears the other, which is the same switch the create path applies; sending
  // both (as the dialog does) lands on the right answer in every combination.
  if (data.audienceUsers !== undefined) {
    // Only the NEWLY added names must still be here. Somebody picked months ago who has since
    // left must not freeze the post: insisting every existing name is still active would make
    // one departed colleague render it uneditable, with nothing on screen saying who.
    const already = new Set((ann.audienceUsers || []).map(String));
    await assertAudienceUsers((data.audienceUsers || []).filter((uid) => !already.has(String(uid))));
    // Normalised the same way the create path normalises, so a post edited and a post created
    // hold the same shape — deduped, cast, no stray strings.
    const ids = [...new Set((data.audienceUsers || []).map(String))]
      .filter((uid) => mongoose.isValidObjectId(uid))
      .map((uid) => new mongoose.Types.ObjectId(uid));
    ann.audienceUsers = ids;
    if (ids.length) ann.audienceRoles = [];
  }
  if (data.audienceRoles !== undefined) {
    ann.audienceRoles = data.audienceRoles;
    if (data.audienceRoles.length) ann.audienceUsers = [];
  }
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
      // Already out. The stamp must sit no earlier than YESTERDAY, whether the rule is
      // being added or changed: the scanner catches up one missed day, and a day before
      // the rule existed is not a missed day. This was learned the hard way — a Friday
      // rule added on a Saturday afternoon anchored on the post's original outing,
      // "yesterday" matched, and fourteen people were told about Friday on Saturday.
      // Today still fires if it matches and its time has passed (the same-day case
      // somebody adding "every Saturday" on a Saturday expects); a day that already went
      // out under an old rule cannot go out again under the new one, since the max keeps
      // that stamp.
      const yesterday = prevDay(today);
      ann.lastRecurredYMD = (ann.lastRecurredYMD || '') > yesterday ? ann.lastRecurredYMD : yesterday;
      if (!was) {
        // Rows from before notifiedAt existed have none; the scanner keys on it, so a
        // repeat added to one of those would never fire. Stamp what is already true.
        if (!ann.notifiedAt) ann.notifiedAt = ann.announcedAt || ann.createdAt;
        if (!ann.announcedAt) ann.announcedAt = ann.notifiedAt;
      }
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

/**
 * Delete an announcement for good, and everything that only existed because of it.
 *
 * This used to be a retire — `isActive: false`, row kept forever — so the feed looked right
 * while the collection quietly grew and the owner, seeing four posts, found six rows. An
 * announcement is a notice, not a record: once it is taken down there is nothing to keep.
 *
 * What goes with it:
 *  • its read receipts (AnnouncementRead), which are meaningless without the post,
 *  • the bells it rang (notifications stamped Announcement/<id>), which would otherwise sit
 *    in people's lists linking to a post that is gone — older ones, from before that stamp
 *    existed, carry no link to find them by and age out on their own 30-day TTL,
 *  • the pointer any work-from-home day or emergency holiday kept to it, nulled rather than
 *    left dangling so undoing that day does not go looking for a post that no longer exists.
 *
 * The Activity log keeps the title and the counts (see the controller) — the row is gone,
 * the record of removing it is not.
 */
export async function deleteAnnouncement(id) {
  const ann = await Announcement.findById(id).select('title audienceRoles priority');
  if (!ann) throw httpError(404, 'NOT_FOUND', 'Announcement not found');

  const reads = await AnnouncementRead.deleteMany({ announcement: ann._id });
  await clearNotificationsFor('Announcement', ann._id);
  // Only the entries that actually point at THIS announcement; the day itself stays.
  //
  // The filter has to name the field as well as the key. An arrayFilters update THROWS with
  // "the path must exist in the document" when the array is absent, and these arrays only
  // come into being the first time something is pushed onto them — so on a settings document
  // that has never had an emergency holiday declared, a bare {key:'global'} filter made every
  // announcement delete fail. Matching on the field means such a document simply isn't
  // matched, which is also the right answer: nothing in it points here.
  for (const field of ['wfhDays', 'emergencyHolidays']) {
    // eslint-disable-next-line no-await-in-loop
    await Setting.updateOne(
      { key: 'global', [`${field}.announcementId`]: ann._id },
      { $set: { [`${field}.$[e].announcementId`]: null } },
      { arrayFilters: [{ 'e.announcementId': ann._id }] },
    );
  }
  Setting.invalidateCache();
  await Announcement.deleteOne({ _id: ann._id });

  return { title: ann.title, readsRemoved: reads.deletedCount || 0 };
}
