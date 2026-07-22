import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { mine } from '../controllers/snapshot.controller.js';

export const snapshotRouter = express.Router();

// No permission gate and none needed: the service only ever reads req.user's own
// data. There is no id parameter, so there is nothing to point at somebody else.
snapshotRouter.use(requireAuth);
snapshotRouter.get('/', mine);
