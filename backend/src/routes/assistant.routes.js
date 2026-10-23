import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { ok } from '../lib/apiResponse.js';
import { claudePing, CLAUDE_MODEL, claudeConfigured } from '../lib/claude.js';
import { ask, confirm } from '../services/assistant/index.js';

/**
 * AI Buddy (plan: audits/15-ai-buddy-plan.md).
 *
 * `/ask` buddy ka asli darwaza hai. `/ping` aur `/status` uske aas-paas ka intezaam —
 * ek jaanch ke liye, doosra ye batane ke liye ki buddy chaalu hai ya nahi.
 */
export const assistantRouter = express.Router();

assistantRouter.use(requireAuth);

/**
 * Jaanch — owner ke liye. Har call par EK asli (chhoti) Claude request jaati hai, yaani
 * ispar paisa lagta hai. Isliye `manageSettings` ke peeche: ise koi bhi baar-baar na
 * daba sake.
 */
assistantRouter.get('/ping', requirePermission('manageSettings'), async (_req, res, next) => {
  try {
    res.json(ok(await claudePing()));
  } catch (err) {
    next(err);
  }
});

/**
 * Buddy dikhana hai ya nahi — frontend ke liye. Ye koi Claude request NAHI bhejta
 * (mufat hai), isliye har signed-in user ke liye khula hai.
 */
assistantRouter.get('/status', (_req, res) => {
  res.json(ok({ enabled: claudeConfigured(), model: CLAUDE_MODEL }));
});

/**
 * Buddy se ek sawaal.
 *
 * Koi permission gate NAHI — har signed-in banda poochh sakta hai. Rok tools me hai:
 * is bande ko sirf wahi tools bheje jaate hain jo `can()` ijaazat deta hai, aur jo tool
 * nahi bheja gaya wo bulaya hi nahi ja sakta. Ghanta-bhar ki ginti `ask()` ke andar.
 */
assistantRouter.post('/ask', async (req, res, next) => {
  try {
    res.json(ok(await ask(req.user, req.body?.question)));
  } catch (err) {
    next(err);
  }
});

/**
 * Tajweez par haan.
 *
 * Body me sirf `id` — "kya karna hai" client se kabhi nahi aata. Wo server ke paas
 * pehle se likha hai, aur wahi uthaya jaata hai (dekho services/assistant/actions.js).
 */
assistantRouter.post('/confirm', async (req, res, next) => {
  try {
    res.json(ok(await confirm(req.user, req.body?.id)));
  } catch (err) {
    next(err);
  }
});
