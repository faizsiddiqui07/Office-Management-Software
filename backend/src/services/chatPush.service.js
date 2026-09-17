import { ChatPushState } from '../models/ChatPushState.js';
import { hasConversationOpen } from './chatRealtime.service.js';

/**
 * Chat ka notification — kab bhejna hai, aur kya likhna hai.
 *
 * Teen niyam yahan ek jagah baithe hain:
 *
 * 1. CONTENT KABHI NAHI. Notification me message ka text nahi jaata — sirf kisne bheja.
 *    Owner ka faisla: mez par pada phone kisi rahgeer ko chat na padha de.
 *
 * 2. JO CHAT SAAMNE KHULI HAI, USKA NOTIFICATION NAHI. Aur ye faisla YAHAN (server par)
 *    hota hai, service worker me nahi — ye majboori hai, shauq nahi: agar service worker
 *    push lekar notification na dikhaye, to Chrome origin ko "budget" me penalise karta
 *    hai aur subscription tak radd kar sakta hai.
 *
 * 3. DAS MESSAGE PAR DAS GHANTIYAN NAHI. Pehle par poora notification aur buzz; uske
 *    baad ki thodi der me aane wale message wahi notification chupchap badal dete hain —
 *    "3 naye message". Ye ek hi `tag` aur `renotify: false` se hota hai.
 *
 * Poora kaam best-effort hai: notification na jaana message bhejne ko fail nahi karta.
 */

const WINDOW_MS = 2 * 60 * 1000;

/**
 * Kaun bhejta hai — bahar se badla ja sakta hai.
 *
 * Default asli Web Push hai. Test me ek nakli sender lagakar ye dekha jaata hai ki KYA
 * bheja gaya — kitni baar, kis text ke saath — bina kisi ke phone par kuch bheje. Yahi
 * tareeka chatRealtime.service me bhi hai (ESM module ko baad me badla nahi ja sakta,
 * isliye seam pehle se rakhna padta hai).
 */
let pushSender = null;
export function setPushSender(fn) {
  pushSender = typeof fn === 'function' ? fn : null;
}
async function deliver(userId, payload) {
  if (pushSender) return pushSender(userId, payload);
  const { sendPush } = await import('../lib/push.js');
  return sendPush(userId, payload);
}

/** Notification ka text — naam bhejne wale ka, baaki kuch nahi. */
function bodyFor(count, fileLabel) {
  if (count > 1) return `${count} new messages`;
  return fileLabel || 'Sent you a message';
}

/**
 * Naye message ki khabar.
 *
 * @param {object} o
 * @param {any}    o.toUser          kise bhejna hai
 * @param {string} o.fromName        kisne bheja (notification ka title)
 * @param {any}    o.conversationId  kis chat me
 * @param {string} [o.fileLabel]     "Ek PDF bheji" jaisa — file wale message par
 * @param {boolean} [o.muted]        is chat ki ghanti band hai
 */
export async function notifyNewMessage({ toUser, fromName, conversationId, fileLabel = '', muted = false }) {
  try {
    if (!toUser || muted) return { sent: false, reason: 'muted' };

    // Wo chat abhi uske saamne khuli hai? To rehne do.
    if (await hasConversationOpen(toUser, conversationId).catch(() => false)) {
      return { sent: false, reason: 'watching' };
    }

    const key = `${toUser}:${conversationId}`;
    const state = await ChatPushState.findOneAndUpdate(
      { key },
      {
        $inc: { count: 1 },
        // Khidki har naye message par aage sarakti hai — baat-cheet chalti rahe to ginti
        // chalti rahegi, aur ruk jaye to apne aap reset ho jayegi.
        $set: { expiresAt: new Date(Date.now() + WINDOW_MS) },
      },
      { upsert: true, new: true },
    );

    const first = state.count <= 1;
    await deliver(toUser, {
      title: fromName || 'Naya message',
      body: bodyFor(state.count, fileLabel),
      link: `/chat?c=${conversationId}`,
      // Tag per-chat hai: ek chat ka notification doosri chat ka notification na mitaye,
      // par USI chat ke naye message purane ko badal dein.
      type: `chat:${conversationId}`,
      // Sirf pehli baar buzz. Uske baad wahi notification chupchap badalta rehta hai.
      renotify: first,
    });
    return { sent: true, count: state.count, buzzed: first };
  } catch {
    return { sent: false, reason: 'error' };
  }
}

/**
 * Chat khulte hi uski ginti saaf — agli baar phir se poora notification aur buzz mile.
 * (Warna khidki ke andar chat padh lene par bhi agla message "2 naye message" kehta.)
 */
export async function clearPushState(userId, conversationId) {
  try {
    await ChatPushState.deleteOne({ key: `${userId}:${conversationId}` });
  } catch {
    // ginti hi to hai
  }
}
