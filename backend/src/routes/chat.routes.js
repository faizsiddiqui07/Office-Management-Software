import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ok } from '../lib/apiResponse.js';
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
} from '../services/chat.service.js';

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

// One page of history, newest first. ?before=<seq> walks backwards.
chatRouter.get('/conversations/:id/messages', handle((req) =>
  listMessages(req.user, req.params.id, { before: req.query.before, limit: req.query.limit })));

chatRouter.post('/conversations/:id/messages', handle((req) =>
  sendMessage(req.user, req.params.id, { text: req.body?.text, replyToSeq: req.body?.replyToSeq })));

// I've read this chat up to here (blank = all of it).
chatRouter.post('/conversations/:id/read', handle((req) =>
  markRead(req.user, req.params.id, req.body?.upToSeq)));

chatRouter.post('/conversations/:id/mute', handle((req) =>
  setMuted(req.user, req.params.id, req.body?.until ?? null)));

// Hide one message from my own view; the other side keeps it.
chatRouter.delete('/messages/:id', handle((req) => deleteForMe(req.user, req.params.id)));
