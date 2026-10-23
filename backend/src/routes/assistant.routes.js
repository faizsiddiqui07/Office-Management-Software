import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { ok } from '../lib/apiResponse.js';
import { claudePing, CLAUDE_MODEL, claudeConfigured } from '../lib/claude.js';

/**
 * AI Buddy (plan: audits/15-ai-buddy-plan.md).
 *
 * Phase 0 me yahan sirf EK raasta hai — ye jaanchne ka ki key lagi hai aur model jawab
 * de raha hai. Buddy ka asli `/ask` Phase 1 me aayega, apne tools ke saath.
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
