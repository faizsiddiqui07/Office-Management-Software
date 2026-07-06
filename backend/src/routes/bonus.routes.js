import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { me, guide, getConfig, updateConfig, award, removeEntry, leaderboard } from '../controllers/bonus.controller.js';

export const bonusRouter = express.Router();

bonusRouter.use(requireAuth);

// Any signed-in user: their own points + the public price list.
bonusRouter.get('/me', me);
bonusRouter.get('/guide', guide);

// Leadership (Settings access): configure, award, undo, leaderboard.
bonusRouter.get('/config', requirePermission('manageSettings'), getConfig);
bonusRouter.patch('/config', requirePermission('manageSettings'), updateConfig);
bonusRouter.post('/award', requirePermission('manageSettings'), award);
bonusRouter.delete('/entry/:id', requirePermission('manageSettings'), removeEntry);
bonusRouter.get('/leaderboard', requirePermission('manageSettings'), leaderboard);
