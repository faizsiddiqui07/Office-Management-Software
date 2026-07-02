import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { myRequests, pending, history, create, decide, remove } from '../controllers/regularization.controller.js';

export const regularizationRouter = express.Router();

regularizationRouter.use(requireAuth);

// Everyone — their own requests / raise a request.
regularizationRouter.get('/me', myRequests);
regularizationRouter.post('/', create);

// Leadership (Director / CEO) — review + decide + history + delete a record.
regularizationRouter.get('/', requirePermission('approveRegularization'), pending);
regularizationRouter.get('/history', requirePermission('approveRegularization'), history);
regularizationRouter.post('/:id/decide', requirePermission('approveRegularization'), decide);
regularizationRouter.delete('/:id', requirePermission('approveRegularization'), remove);
