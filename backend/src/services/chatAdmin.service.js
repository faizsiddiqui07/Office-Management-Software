import mongoose from 'mongoose';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { User } from '../models/User.js';
import { audit } from '../models/AuditLog.js';
import { notify } from '../models/Notification.js';
import { isOwnerRole } from '../lib/roles.js';
import { openBytes } from '../lib/secretBox.js';

/**
 * ⚠️  YE FILE POORE CHAT KA EKMATRA APWAAD HAI.
 *
 * Baaki har jagah niyam ek hi hai: har query ka filter hi membership hai
 * (`participants: me`), isliye koi bhool bhi ho jaye to kisi aur ki chat nahi dikh
 * sakti. Yahan wo filter JAAN-BUJH KAR nahi lagta — kyunki owner ka faisla yahi hai:
 * zaroorat padne par (POSH shikayat, resign ke baad handover, "usne client ko kya bheja
 * tha") CEO & President kisi ki bhi chat nikal sakein.
 *
 * Isliye is apwaad ke teen taale hain, aur teeno hamesha lagne chahiye:
 *
 *   1. SIRF CEO & PRESIDENT. `isOwnerRole` — Director, Manager, HR, kisi ko nahi.
 *   2. HAR BAAR ACTIVITY LOG. Kab, kisne, kiski chat kholi — Activity page par.
 *   3. HAR BAAR US EMPLOYEE KO NOTIFICATION. Use pata chalega ki uski chat dekhi gayi.
 *      Ye chhupi hui taak-jhaank nahi hai; employees ko likhit me bataya gaya hai ki
 *      company zaroorat par dekh sakti hai AUR dekhne par unhe bata diya jayega.
 *
 * Yahan koi bhi naya function jodte waqt teeno taale lagane hain. Bina notification ke
 * "chupke se dekh lene" ka raasta banana is poore design ka wada todta hai.
 *
 * Ek aur baat: admin ka dekhna kisi ka unread nahi badalta, na koi tick neela karta hai,
 * na koi "padha gaya" nishaan chhodta hai. Wo sirf padhta hai, chat me maujood nahi hota.
 */

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/** Taala #1 — sirf CEO & President. */
function requireOwner(admin) {
  if (!isOwnerRole(admin?.role)) {
    throw httpError(403, 'FORBIDDEN', 'Only the CEO & President can view chat records');
  }
}

const readBody = (buf) => {
  if (!buf || !buf.length) return '';
  const out = openBytes(buf);
  return out === null ? '⚠️ Ye message khola nahi ja saka' : out;
};

/** Taale #2 aur #3 — ek saath, taaki koi ek chhoot na jaye. */
async function recordAccess(admin, target, conversation, what) {
  await audit({
    actor: admin._id,
    action: 'chat.read',
    entityType: 'Conversation',
    entityId: conversation?._id ?? null,
    // Message ka matn kabhi audit me nahi jaata — wo log ko hi ek doosri chat-copy bana
    // deta, jise aur bhi zyada log padh sakte hain.
    meta: { targetUser: String(target._id), targetName: target.name, what },
  });
  await notify({
    user: target._id,
    type: 'CHAT_ACCESS',
    title: 'Your chat was viewed',
    message: `${admin.name} ${what}`,
    link: '/chat',
  });
}

/** Kis-kis se is bande ki baat hui hai (sirf list, koi message nahi). */
export async function listUserChats(admin, userId) {
  requireOwner(admin);
  if (!mongoose.isValidObjectId(userId)) throw httpError(404, 'NOT_FOUND', 'Person not found');

  const target = await User.findById(userId).select('name email designation avatarUrl isActive').lean();
  if (!target) throw httpError(404, 'NOT_FOUND', 'Person not found');

  const convs = await Conversation.find({ participants: userId })
    .sort({ lastMessageAt: -1 })
    .populate('participants', 'name avatarUrl designation')
    .lean();

  return {
    user: {
      id: String(target._id),
      name: target.name,
      email: target.email,
      designation: target.designation || '',
      avatarUrl: target.avatarUrl || '',
      isActive: target.isActive,
    },
    chats: convs
      .filter((c) => c.lastMessageAt)
      .map((c) => {
        const other = c.participants.find((p) => String(p._id) !== String(userId));
        return {
          id: String(c._id),
          with: other ? { id: String(other._id), name: other.name, designation: other.designation || '' } : null,
          lastMessageAt: c.lastMessageAt,
          messageCount: c.lastSeq,
        };
      }),
  };
}

/**
 * Ek poori chat padho.
 *
 * Yahan `participants: me` NAHI hai — yahi wo apwaad hai jiske baare me upar likha hai.
 * Uski keemat teen taale hain, aur teeno isi function me lagte hain.
 */
export async function readUserChat(admin, userId, conversationId, { limit = 500 } = {}) {
  requireOwner(admin);
  if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(conversationId)) {
    throw httpError(404, 'NOT_FOUND', 'Chat not found');
  }

  const target = await User.findById(userId).select('name').lean();
  if (!target) throw httpError(404, 'NOT_FOUND', 'Person not found');

  // Chat us bande ki honi CHAHIYE — admin bhi koi bhi random chat nahi khol sakta, wo
  // jis employee ki jaanch kar raha hai bas usi ki.
  const conv = await Conversation.findOne({ _id: conversationId, participants: userId })
    .populate('participants', 'name designation')
    .lean();
  if (!conv) throw httpError(404, 'NOT_FOUND', 'Chat not found');

  const n = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const rows = await Message.find({ conversation: conv._id })
    .sort({ seq: 1 })
    .limit(n)
    .populate('sender', 'name')
    .lean();

  const other = conv.participants.find((p) => String(p._id) !== String(userId));
  await recordAccess(admin, { _id: userId, name: target.name }, conv,
    `opened your chat with ${other?.name || 'someone'}`);

  return {
    conversation: {
      id: String(conv._id),
      between: conv.participants.map((p) => ({ id: String(p._id), name: p.name })),
      messageCount: conv.lastSeq,
    },
    messages: rows.map((m) => ({
      id: String(m._id),
      seq: m.seq,
      senderId: String(m.sender?._id ?? m.sender),
      senderName: m.sender?.name || 'Unknown',
      kind: m.kind,
      text: readBody(m.body),
      file: m.kind === 'FILE' && m.file?.key
        ? { name: readBody(m.file.name) || 'file', mime: m.file.mime, size: m.file.size }
        : null,
      // Kisne apne liye hataya — jaanch me yahi sawaal aata hai ("usne delete kar diya
      // tha"). Matn phir bhi maujood hai, kyunki delete-for-me sirf apni nazar se hataata
      // hai.
      deletedForCount: (m.deletedFor || []).length,
      // "Delete for everyone" — participants ko ye gaya hua dikhta hai, par records me
      // matn maujood hai (wajah Message.js me). Nishaan ke saath dikhao.
      deletedForEveryoneAt: m.deletedAt || null,
      createdAt: m.createdAt,
    })),
    truncated: conv.lastSeq > rows.length,
  };
}

/**
 * Apni hi chat me dhoondho.
 *
 * Message database me encrypted pade hain, isliye MongoDB unme text nahi khoj sakta —
 * server unhe khol kar khud chhaanta hai. Isliye scan ki ek seema hai (sabse naye
 * MAX_SCAN), warna ek lambi chat wala banda har search par poora itihaas khulwa deta.
 */
const MAX_SCAN = 4000;

export async function searchMyMessages(user, q, { limit = 40 } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  if (needle.length < 2) return { results: [], scanned: 0 };

  const rows = await Message.find({ participants: user._id, deletedFor: { $ne: user._id }, deletedAt: null, kind: 'TEXT' })
    .sort({ createdAt: -1 })
    .limit(MAX_SCAN)
    .select('conversation seq sender body createdAt')
    .lean();

  const convIds = new Set();
  const hits = [];
  for (const m of rows) {
    const text = readBody(m.body);
    if (!text.toLowerCase().includes(needle)) continue;
    hits.push({
      id: String(m._id),
      conversationId: String(m.conversation),
      seq: m.seq,
      mine: String(m.sender) === String(user._id),
      text,
      createdAt: m.createdAt,
    });
    convIds.add(String(m.conversation));
    if (hits.length >= Math.min(Number(limit) || 40, 100)) break;
  }

  // Har nateeje ke saath "kis se baat thi" — warna aadha jawab bekaar hai.
  const convs = await Conversation.find({ _id: { $in: [...convIds] }, participants: user._id })
    .populate('participants', 'name avatarUrl')
    .lean();
  const byId = new Map(convs.map((c) => {
    const other = c.participants.find((p) => String(p._id) !== String(user._id));
    return [String(c._id), other ? { id: String(other._id), name: other.name, avatarUrl: other.avatarUrl || '' } : null];
  }));

  return {
    results: hits.map((h) => ({ ...h, peer: byId.get(h.conversationId) || null })),
    scanned: rows.length,
    // Scan ki seema chhoo gayi — user ko batana zaroori hai, warna "mera purana message
    // mila hi nahi" ek chupchap jhooth ban jaata hai.
    capped: rows.length >= MAX_SCAN,
  };
}
