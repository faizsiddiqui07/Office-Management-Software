import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ok } from '../lib/apiResponse.js';
import { getBadges } from '../services/badges.service.js';

export const badgesRouter = express.Router();

// One small call for every sidebar dot — the client polls this, not each section.
badgesRouter.use(requireAuth);
badgesRouter.get('/', async (req, res, next) => {
  try {
    res.json(ok(await getBadges(req.user)));
  } catch (err) {
    next(err);
  }
});
