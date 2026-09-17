import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ok } from '../lib/apiResponse.js';
import { issueTicket, TICKET_TTL_SECONDS } from '../lib/chatTicket.js';
import { realtimeEnabled } from '../services/chatRealtime.service.js';
import {
  listContacts,
  listConversations,
  unreadTotal,
  openDirect,
  listMessages,
  sendMessage,
  markRead,
  deleteForMe,
  setMuted,
  requestUpload,
  mediaLink,
  mediaConfig,
} from '../services/chat.service.js';
import { listUserChats, readUserChat, searchMyMessages } from '../services/chatAdmin.service.js';

/**
 * 1:1 chat.
 *
 * Every route here is behind requireAuth AND the service's own `participants: me`
 * filter — the router never decides who may see a conversation, the query does. See the
 * note at the top of chat.service.js for why that is the only arrangement that can't
 * leak somebody else's chat through a forgotten check.
 */
export const chatRouter = express.Router();

chatRouter.use(requireAuth);

const handle = (fn) => async (req, res, next) => {
  try {
    res.json(ok(await fn(req, res)));
  } catch (err) {
    next(err);
  }
};

// Who I can talk to — every other active colleague.
chatRouter.get('/contacts', handle((req) => listContacts(req.user)));

// My chat list, newest first.
chatRouter.get('/conversations', handle((req) => listConversations(req.user)));

// Just the number for the floating button's badge.
chatRouter.get('/unread', handle(async (req) => ({ unread: await unreadTotal(req.user._id) })));

// Start (or reopen) the chat with one colleague.
chatRouter.post('/conversations', handle((req) => openDirect(req.user, req.body?.peerId)));

/**
 * WebSocket kholne ki parchi.
 *
 * Browser ka WebSocket custom header nahi bhej sakta, isliye pehchaan URL me jaati hai —
 * aur URL access logs me likha jaata hai. Login token yahan bhejna khatarnaak hai (is app
 * me wo lifetime hai), isliye ek 60-second ki alag parchi milti hai. Client har baar
 * judne se pehle nayi le leta hai.
 */
chatRouter.get('/ws-ticket', handle((req) => ({
  ticket: issueTicket(req.user._id),
  expiresIn: TICKET_TTL_SECONDS,
  // Client ko pata hona chahiye ki live connection sambhav hai ya nahi — nahi hai to wo
  // polling par hi chalta rehta hai, koi error nahi.
  url: process.env.CHAT_WS_URL || '',
  enabled: !!process.env.CHAT_WS_URL && realtimeEnabled(),
})));

// One page of history. ?before=<seq> walks backwards (purana), ?after=<seq> aage —
// `after` hi reconnect ke baad chhoote hue message bharta hai.
chatRouter.get('/conversations/:id/messages', handle((req) =>
  listMessages(req.user, req.params.id, {
    before: req.query.before,
    after: req.query.after,
    limit: req.query.limit,
  })));

chatRouter.post('/conversations/:id/messages', handle((req) =>
  sendMessage(req.user, req.params.id, {
    text: req.body?.text,
    replyToSeq: req.body?.replyToSeq,
    upload: req.body?.upload,
  })));

// File bhejne se pehle: browser ko S3 ka seedha upload parwana. Bytes Lambda se guzarte
// hi nahi — API Gateway ka ~6MB cap aur 30s timeout isi tarah bypass hote hain.
chatRouter.post('/conversations/:id/uploads', handle((req) =>
  requestUpload(req.user, req.params.id, { withThumb: !!req.body?.withThumb })));

// File kholne ka 5-minute wala link (?thumb=1 se chhoti jhalak).
chatRouter.get('/media/:id', handle((req) =>
  mediaLink(req.user, req.params.id, { thumb: req.query.thumb === '1' })));

// Frontend ko pata hona chahiye ki attachment ka button dikhana bhi hai ya nahi.
chatRouter.get('/media-config', handle(() => mediaConfig()));

// I've read this chat up to here (blank = all of it).
chatRouter.post('/conversations/:id/read', handle((req) =>
  markRead(req.user, req.params.id, req.body?.upToSeq)));

chatRouter.post('/conversations/:id/mute', handle((req) =>
  setMuted(req.user, req.params.id, req.body?.until ?? null)));

// Hide one message from my own view; the other side keeps it.
chatRouter.delete('/messages/:id', handle((req) => deleteForMe(req.user, req.params.id)));


// Apni hi chat me dhoondho. Message encrypted pade hain, isliye MongoDB unme khoj nahi
// sakta — server unhe khol kar chhaanta hai, ek seema tak (dekho chatAdmin.service).
chatRouter.get('/search', handle((req) => searchMyMessages(req.user, req.query.q, { limit: req.query.limit })));

/**
 * ── Sirf CEO & President ──────────────────────────────────────────────────────
 *
 * Yahan se koi bhi kisi ki chat nikal sakta hai — poore chat ka ekmatra apwaad.
 * Har call par teen cheezein hoti hain: role ki jaanch, Activity log me entry, aur us
 * employee ko notification. Teeno chatAdmin.service me hain; wahan ka comment padhein
 * pehle kuch bhi badalne se.
 */
chatRouter.get('/admin/users/:id/chats', handle((req) => listUserChats(req.user, req.params.id)));

chatRouter.get('/admin/users/:id/chats/:conversationId', handle((req) =>
  readUserChat(req.user, req.params.id, req.params.conversationId, { limit: req.query.limit })));
