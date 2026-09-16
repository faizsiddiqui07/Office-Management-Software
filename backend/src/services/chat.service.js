import mongoose from 'mongoose';
import { Conversation, pairKeyOf } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { User } from '../models/User.js';
import { sealBytes, openBytes } from '../lib/secretBox.js';
import { publishToUsers, hasConversationOpen } from './chatRealtime.service.js';

/**
 * 1:1 chat.
 *
 * ONE rule runs through this whole file and must never be relaxed: every read and every
 * write is filtered by `participants: me`. Not "look it up, then check" — the membership
 * IS the query. A route that forgets a check therefore cannot leak, because there is no
 * code path that fetches a conversation or a message by id alone. `findById` is banned
 * here for exactly that reason.
 *
 * When nothing matches we answer 404, never 403: a 403 would confirm that the id exists
 * and belongs to somebody, which is itself a leak (it tells you who is talking to whom).
 */

const PREVIEW_CHARS = 80;
const PAGE = 30;

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

const isId = (v) => mongoose.isValidObjectId(v);

/** Ciphertext → text for the client. `null` means "stored but won't open" — say so. */
function readBody(buf) {
  if (!buf || !buf.length) return '';
  const out = openBytes(buf);
  return out === null ? '⚠️ This message could not be opened' : out;
}

/** Trim to a preview and seal it. Used for the chat list's last line. */
function sealPreview(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return sealBytes(t.length > PREVIEW_CHARS ? `${t.slice(0, PREVIEW_CHARS - 1)}…` : t);
}

/** The person on the other side of a DIRECT conversation. */
const peerOf = (conv, meId) => conv.participants.find((p) => String(p._id ?? p) !== String(meId));
const memberOf = (conv, meId) => conv.members.find((m) => String(m.user) === String(meId));

/**
 * Everyone this person may start a chat with: every other active colleague.
 *
 * An office directory is the contact list — there is no "add contact" step to build,
 * and no way to discover somebody who isn't already a colleague.
 */
export async function listContacts(user) {
  const rows = await User.find({ isActive: true, _id: { $ne: user._id } })
    .select('name avatarUrl designation department role')
    .sort({ name: 1 })
    .lean();
  return rows.map((u) => ({
    id: String(u._id),
    name: u.name,
    avatarUrl: u.avatarUrl || '',
    designation: u.designation || '',
    department: u.department || '',
  }));
}

/** My chats, newest first, with the other person, the last line and my unread count. */
export async function listConversations(user) {
  const convs = await Conversation.find({ participants: user._id })
    .sort({ lastMessageAt: -1 })
    .limit(200)
    .populate('participants', 'name avatarUrl designation')
    .lean();

  return convs
    .filter((c) => c.lastMessageAt) // an opened-but-never-used thread isn't a chat yet
    .map((c) => {
      const me = c.members.find((m) => String(m.user) === String(user._id));
      const peerMember = c.members.find((m) => String(m.user) !== String(user._id));
      const peer = peerOf(c, user._id);
      return {
        id: String(c._id),
        // Chat list par bhi asli tick dikhana hai. Iske bina list har apne message par
        // double-tick dikhati thi — chahe saamne wale ne khola bhi na ho, jo jhooth hai.
        lastMessageSeq: c.lastSeq,
        peerDeliveredUpToSeq: peerMember?.deliveredUpToSeq || 0,
        peerReadUpToSeq: peerMember?.readUpToSeq || 0,
        peer: peer
          ? { id: String(peer._id), name: peer.name, avatarUrl: peer.avatarUrl || '', designation: peer.designation || '' }
          : null,
        lastMessage: readBody(c.lastMessagePreview),
        lastMessageAt: c.lastMessageAt,
        lastMessageMine: String(c.lastMessageBy) === String(user._id),
        lastMessageKind: c.lastMessageKind,
        unread: me?.unread || 0,
        muted: !!(me?.mutedUntil && me.mutedUntil > new Date()),
      };
    });
}

/** Total unread across all my chats — what the floating button's badge shows. */
export async function unreadTotal(userId) {
  const rows = await Conversation.find({ participants: userId, 'members.unread': { $gt: 0 } })
    .select('members')
    .lean();
  return rows.reduce((sum, c) => {
    const me = c.members.find((m) => String(m.user) === String(userId));
    return sum + (me?.unread || 0);
  }, 0);
}

/**
 * Open (or start) the chat with one colleague.
 *
 * Creating races: two people who tap each other at the same moment both try to insert.
 * The unique index on pairKey makes one of them fail with E11000, and that loser simply
 * re-reads the winner's document — which is why this is safe without a transaction.
 */
export async function openDirect(user, peerId) {
  if (!isId(peerId)) throw httpError(400, 'BAD_ID', 'Unknown person');
  if (String(peerId) === String(user._id)) throw httpError(400, 'SELF_CHAT', 'You cannot chat with yourself');

  const peer = await User.findOne({ _id: peerId, isActive: true }).select('name avatarUrl designation').lean();
  if (!peer) throw httpError(404, 'NOT_FOUND', 'That person is no longer available');

  const pairKey = pairKeyOf(user._id, peerId);
  let conv = await Conversation.findOne({ pairKey });
  if (!conv) {
    try {
      conv = await Conversation.create({
        kind: 'DIRECT',
        pairKey,
        participants: [user._id, peer._id],
        members: [{ user: user._id }, { user: peer._id }],
      });
    } catch (e) {
      if (e?.code !== 11000) throw e;
      conv = await Conversation.findOne({ pairKey }); // the other side won the race
    }
  }
  return {
    id: String(conv._id),
    peer: { id: String(peer._id), name: peer.name, avatarUrl: peer.avatarUrl || '', designation: peer.designation || '' },
  };
}

/** The conversation, but only if it is mine. Everything else in this file goes through it. */
async function mine(conversationId, userId) {
  if (!isId(conversationId)) throw httpError(404, 'NOT_FOUND', 'Chat not found');
  const conv = await Conversation.findOne({ _id: conversationId, participants: userId })
    .populate('participants', 'name avatarUrl designation');
  if (!conv) throw httpError(404, 'NOT_FOUND', 'Chat not found');
  return conv;
}

/**
 * One page of history, newest first. `before` is a seq — pass the oldest seq you already
 * have to get the page before it. Cursor, not skip: skip gets slower the further back you
 * scroll and can repeat or drop a message when a new one arrives mid-scroll.
 */
export async function listMessages(user, conversationId, { before, after, limit } = {}) {
  const conv = await mine(conversationId, user._id);
  const me = memberOf(conv, user._id);
  const n = Math.min(Math.max(Number(limit) || PAGE, 1), 100);

  const q = {
    conversation: conv._id,
    participants: user._id,
    deletedFor: { $ne: user._id },
    seq: { $gt: me?.clearedUpToSeq || 0 },
  };
  if (before != null && Number.isFinite(Number(before))) q.seq.$lt = Number(before);
  // `after` aage ki taraf chalta hai — yahi WebSocket toot-ne ke baad ki BHARPAI hai.
  // API Gateway kisi connection ko 2 ghante se zyada aur 10 minute khaali rehne par
  // nahi rakhta, aur ye dono limits badhai nahi ja sakti. Jab connection tootta hai,
  // us beech ke message socket par kabhi nahi aayenge — client dobara judte hi
  // `after=<mera aakhri seq>` maang kar unhe bhar leta hai. Iske bina message CHUPCHAP
  // gayab hote: na error, na retry — chat app ka sabse bura bug.
  if (after != null && Number.isFinite(Number(after))) q.seq.$gt = Math.max(Number(after), me?.clearedUpToSeq || 0);

  const rows = await Message.find(q).sort({ seq: after != null ? 1 : -1 }).limit(n + 1).lean();
  const hasMore = rows.length > n;
  const kept = hasMore ? rows.slice(0, n) : rows;
  // Peeche wala page naya→purana aata hai, aage wala pehle se purana→naya. Render
  // hamesha purana→naya hota hai, isliye sirf peeche wale ko ulta karo.
  const page = after != null ? kept : [...kept].reverse();

  const peer = peerOf(conv, user._id);
  const peerMember = conv.members.find((m) => String(m.user) !== String(user._id));

  return {
    conversation: {
      id: String(conv._id),
      peer: peer ? { id: String(peer._id), name: peer.name, avatarUrl: peer.avatarUrl || '', designation: peer.designation || '' } : null,
      // The other person's watermarks: this is what turns my bubbles into one tick,
      // two ticks, or blue ticks — no per-message lookup needed.
      peerDeliveredUpToSeq: peerMember?.deliveredUpToSeq || 0,
      peerReadUpToSeq: peerMember?.readUpToSeq || 0,
      myUnread: me?.unread || 0,
      muted: !!(me?.mutedUntil && me.mutedUntil > new Date()),
    },
    hasMore,
    messages: page.map((m) => ({
      id: String(m._id),
      seq: m.seq,
      mine: String(m.sender) === String(user._id),
      sender: String(m.sender),
      kind: m.kind,
      text: readBody(m.body),
      replyTo: m.replyTo?.seq
        ? { seq: m.replyTo.seq, mine: String(m.replyTo.sender) === String(user._id), text: readBody(m.replyTo.preview) }
        : null,
      editedAt: m.editedAt,
      createdAt: m.createdAt,
    })),
  };
}

/**
 * Send a message.
 *
 * Two writes, and the first one does four jobs at once: hand out the next seq, stamp the
 * preview and time on the conversation, and add 1 to the OTHER person's unread. Doing
 * them together is what keeps a busy chat inside the free database tier's operations
 * budget — and it means the seq can never be handed to two senders.
 */
export async function sendMessage(user, conversationId, { text, replyToSeq } = {}) {
  const clean = String(text ?? '').trim();
  if (!clean) throw httpError(400, 'EMPTY', 'Type something to send');
  if (clean.length > 4000) throw httpError(400, 'TOO_LONG', 'That message is too long (4000 characters max)');

  const conv = await mine(conversationId, user._id);

  let replyTo;
  if (replyToSeq != null) {
    const q = await Message.findOne({ conversation: conv._id, participants: user._id, seq: Number(replyToSeq) })
      .select('seq sender body').lean();
    if (q) replyTo = { seq: q.seq, sender: q.sender, preview: sealPreview(readBody(q.body)) };
  }

  const stamped = await Conversation.findOneAndUpdate(
    { _id: conv._id, participants: user._id },
    {
      $inc: { lastSeq: 1, 'members.$[other].unread': 1 },
      $set: {
        lastMessageAt: new Date(),
        lastMessageBy: user._id,
        lastMessagePreview: sealPreview(clean),
        lastMessageKind: 'TEXT',
      },
    },
    { new: true, arrayFilters: [{ 'other.user': { $ne: user._id } }] },
  );
  if (!stamped) throw httpError(404, 'NOT_FOUND', 'Chat not found');

  const doc = await Message.create({
    conversation: conv._id,
    seq: stamped.lastSeq,
    sender: user._id,
    participants: conv.participants.map((p) => p._id ?? p),
    kind: 'TEXT',
    body: sealBytes(clean),
    ...(replyTo ? { replyTo } : {}),
  });

  const peerMember = conv.members.find((m) => String(m.user) !== String(user._id));
  const peerId = peerOf(conv, user._id)?._id;
  const mutedNow = peerMember?.mutedUntil && peerMember.mutedUntil > new Date();

  const wire = {
    id: String(doc._id),
    seq: doc.seq,
    sender: String(user._id),
    senderName: user.name,
    kind: 'TEXT',
    text: clean,
    replyTo: replyTo
      ? { seq: replyTo.seq, sender: String(replyTo.sender), text: readBody(replyTo.preview) }
      : null,
    createdAt: doc.createdAt,
  };

  // Turant dono taraf pahunchao — saamne wale ko naya message, aur APNE baaki tabs ko bhi
  // (ek tab se bheja hua message doosre khule tab me bhi turant dikhna chahiye).
  await publishToUsers([peerId, user._id], {
    type: 'chat:message',
    conversationId: String(conv._id),
    message: wire,
  }).catch(() => {});

  // Push — best-effort aur JAAN-BUJH KAR khaali.
  //
  // Do niyam owner ke: notification me message ka text kabhi nahi jaata (mez par pada
  // phone kisi rahgeer ko na padha de), aur chat `Notification` collection me entry nahi
  // banati — wo ghanti approvals/leaves ki hai, aur ek batuni dopahar use daba deti.
  //
  // Aur agar saamne wale ke kisi tab me YE chat abhi khuli hai to push bhejna hi nahi —
  // wo message screen par dekh chuka hai. Ye faisla SERVER par hota hai, service worker
  // me nahi: service worker jo push leke notification na dikhaye, uspar Chrome origin ko
  // penalise karta hai aur subscription tak radd kar sakta hai.
  const watchingNow = await hasConversationOpen(peerId, conv._id).catch(() => false);
  if (!mutedNow && !watchingNow) {
    import('../lib/push.js')
      .then(({ sendPush }) => sendPush(peerId, {
        title: user.name,
        body: 'Aapko ek message bheja',
        link: `/chat?c=${conv._id}`,
        type: `chat:${conv._id}`, // per-chat tag: ek chat doosri ki notification na mitaye
      }))
      .catch(() => {});
  }

  return {
    id: String(doc._id),
    seq: doc.seq,
    mine: true,
    sender: String(user._id),
    kind: 'TEXT',
    text: clean,
    replyTo: replyTo ? { seq: replyTo.seq, mine: String(replyTo.sender) === String(user._id), text: readBody(replyTo.preview) } : null,
    createdAt: doc.createdAt,
    conversationId: String(conv._id),
    peerId: String(peerOf(conv, user._id)?._id ?? ''),
  };
}

/**
 * I have read this chat up to `upToSeq` (or all of it).
 *
 * Resets MY unread and moves MY read watermark — which is what puts blue ticks on the
 * other person's bubbles. Watermarks only ever move forward: an old screen that reports
 * a stale number must not un-read newer messages.
 */
export async function markRead(user, conversationId, upToSeq) {
  const conv = await mine(conversationId, user._id);
  const upto = Number.isFinite(Number(upToSeq)) ? Number(upToSeq) : conv.lastSeq;
  const me = memberOf(conv, user._id);
  if (!me) throw httpError(404, 'NOT_FOUND', 'Chat not found');
  if (upto <= (me.readUpToSeq || 0)) return { readUpToSeq: me.readUpToSeq || 0, unread: me.unread || 0 };

  const updated = await Conversation.findOneAndUpdate(
    { _id: conv._id, participants: user._id },
    {
      $set: {
        'members.$[me].readUpToSeq': upto,
        'members.$[me].deliveredUpToSeq': Math.max(upto, me.deliveredUpToSeq || 0),
        'members.$[me].unread': 0,
        'members.$[me].lastReadAt': new Date(),
      },
    },
    { new: true, arrayFilters: [{ 'me.user': user._id }] },
  );
  const m = memberOf(updated, user._id);

  // Saamne wale ke tick turant neele ho jaayein — uske liye ye event hi sab kuch hai.
  const peerId = peerOf(conv, user._id)?._id;
  await publishToUsers([peerId], {
    type: 'chat:read',
    conversationId: String(conv._id),
    by: String(user._id),
    upToSeq: upto,
  }).catch(() => {});

  return { readUpToSeq: m?.readUpToSeq || 0, unread: 0 };
}

/** Hide one message from MY view only. The other side keeps it, exactly like WhatsApp. */
export async function deleteForMe(user, messageId) {
  if (!isId(messageId)) throw httpError(404, 'NOT_FOUND', 'Message not found');
  const res = await Message.updateOne(
    { _id: messageId, participants: user._id },
    { $addToSet: { deletedFor: user._id } },
  );
  if (!res.matchedCount) throw httpError(404, 'NOT_FOUND', 'Message not found');
  return { id: String(messageId) };
}

/** Mute / unmute this chat's notifications for me. `until` null = unmute. */
export async function setMuted(user, conversationId, until) {
  const conv = await mine(conversationId, user._id);
  await Conversation.updateOne(
    { _id: conv._id, participants: user._id },
    { $set: { 'members.$[me].mutedUntil': until ? new Date(until) : null } },
    { arrayFilters: [{ 'me.user': user._id }] },
  );
  return { muted: !!until };
}
