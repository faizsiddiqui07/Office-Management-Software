import { ChatConnection } from '../models/ChatConnection.js';

/**
 * Khule WebSocket connections ka hisaab, aur unhe event bhejna.
 *
 * Bhejne ka kaam ek "sender" function karta hai jo bahar se aata hai. Prod me wo
 * API Gateway ka PostToConnection hai; test me ek nakli function. Isi wajah se poori
 * fan-out aur safai wali logic bina AWS ke jaanchi ja sakti hai — aur agar WebSocket
 * abhi set hi nahi hua (endpoint env var khaali), to app chupchap polling par chalti
 * rehti hai, kuch toot-ta nahi.
 */

// API Gateway khud 2 ghante se zyada koi connection zinda nahi rakhta, isliye usse
// purani row jhooth hi hai — TTL yahin se aata hai.
const CONNECTION_TTL_MS = 2 * 60 * 60 * 1000;

let sender = null;

/** Prod me lambda.js ise API Gateway ke PostToConnection se bhar deta hai. */
export function setRealtimeSender(fn) {
  sender = typeof fn === 'function' ? fn : null;
}

export function realtimeEnabled() {
  return !!sender;
}

/** Naya tab jud gaya. */
export async function registerConnection(userId, connectionId, { userAgent = '' } = {}) {
  await ChatConnection.updateOne(
    { connectionId },
    {
      $set: {
        user: userId,
        expiresAt: new Date(Date.now() + CONNECTION_TTL_MS),
        lastSeenAt: new Date(),
        userAgent: String(userAgent || '').slice(0, 200),
      },
    },
    { upsert: true },
  );
}

/** Tab band ho gaya (ya API Gateway ne connection tod diya). */
export async function dropConnection(connectionId) {
  await ChatConnection.deleteOne({ connectionId });
}

/**
 * Keepalive. Client 10 minute se pehle ping karta hai (API Gateway ka idle timeout
 * 10 minute hai aur wo badhaya nahi ja sakta), aur har ping TTL aage sarka deta hai.
 */
export async function touchConnection(connectionId, { activeConversation } = {}) {
  const $set = { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + CONNECTION_TTL_MS) };
  if (activeConversation !== undefined) $set.activeConversation = activeConversation || null;
  await ChatConnection.updateOne({ connectionId }, { $set });
}

/** Kaun-kaun abhi online hai (in user ids me se). */
export async function onlineUserIds(userIds = []) {
  if (!userIds.length) return new Set();
  const rows = await ChatConnection.find({ user: { $in: userIds } }).select('user').lean();
  return new Set(rows.map((r) => String(r.user)));
}

/** Kya is bande ke kisi tab me ye chat abhi khuli hai? (push bhejna hai ya nahi) */
export async function hasConversationOpen(userId, conversationId) {
  const row = await ChatConnection.findOne({ user: userId, activeConversation: conversationId })
    .select('_id')
    .lean();
  return !!row;
}

/**
 * In logon ke har khule tab par ek event bhejo.
 *
 * Jo connection ja chuka hai uspar bhejne ki koshish 410 (GoneException) deti hai —
 * aur wahi hamari safai ka asli zariya hai, kyunki $disconnect chalne ki koi guarantee
 * nahi. Us row ko turant hata dete hain, warna wo har message par ek bekaar (aur
 * billable) call khaati rehti.
 *
 * Poora kaam best-effort hai: event na jaa paana message bhejne ko fail nahi karta —
 * message database me likha ja chuka hai, aur client reconnect par use utha lega.
 */
export async function publishToUsers(userIds, event) {
  if (!sender || !userIds?.length) return { sent: 0, pruned: 0 };
  const ids = [...new Set(userIds.map(String))];
  const conns = await ChatConnection.find({ user: { $in: ids } }).select('connectionId user').lean();
  if (!conns.length) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(event);
  const dead = [];
  let sent = 0;

  await Promise.all(
    conns.map(async (c) => {
      try {
        await sender(c.connectionId, body);
        sent += 1;
      } catch (err) {
        // 410 = ye connection ab hai hi nahi. Baaki koi bhi gadbad ho to row rehne do —
        // ek arzi network dikkat par kisi ka zinda connection mitana galat hoga.
        if (err?.name === 'GoneException' || err?.$metadata?.httpStatusCode === 410) dead.push(c.connectionId);
      }
    }),
  );

  if (dead.length) await ChatConnection.deleteMany({ connectionId: { $in: dead } });
  return { sent, pruned: dead.length };
}
