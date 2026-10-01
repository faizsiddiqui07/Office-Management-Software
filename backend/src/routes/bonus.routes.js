import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { me, guide, getConfig, updateConfig, award, removeEntry, leaderboard, awards, backfill, recalculate, userSummary, rebuildPreview, rebuildApply } from '../controllers/bonus.controller.js';

export const bonusRouter = express.Router();

bonusRouter.use(requireAuth);

// Any signed-in user: their own points + the public price list.
bonusRouter.get('/me', me);
bonusRouter.get('/guide', guide);

// Leadership (Settings access): configure, award, undo, leaderboard.
bonusRouter.get('/config', requirePermission('manageSettings'), getConfig);
bonusRouter.patch('/config', requirePermission('manageSettings'), updateConfig);
bonusRouter.post('/award', requirePermission('manageSettings'), award);
bonusRouter.get('/awards', requirePermission('manageSettings'), awards);
bonusRouter.get('/leaderboard', requirePermission('manageSettings'), leaderboard);
// One person's breakdown for a period — leaderboard drill-down.
bonusRouter.get('/user/:id', requirePermission('manageSettings'), userSummary);
// Score a past month on purpose (the automatic scans never reach backwards).
bonusRouter.post('/backfill', requirePermission('manageSettings'), backfill);
// Recalculate everything now (manual re-run of the nightly scoring). Idempotent.
bonusRouter.post('/recalculate', requirePermission('manageSettings'), recalculate);
// The DEEP recalculation — re-decides every attendance-derived award from go-live, which
// the one above cannot do (it respects the streak and month-rollup watermarks by design).
// Preview first, then apply. Both are CEO & President only — enforced in the service, like
// deleting an award, because this moves other people's points and manageSettings is a wider
// group than the owner tier.
bonusRouter.get('/rebuild/preview', requirePermission('manageSettings'), rebuildPreview);
bonusRouter.post('/rebuild', requirePermission('manageSettings'), rebuildApply);
// Deleting points is owner-only (CEO & President) — enforced in the service.
bonusRouter.delete('/entry/:id', requirePermission('manageSettings'), removeEntry);
