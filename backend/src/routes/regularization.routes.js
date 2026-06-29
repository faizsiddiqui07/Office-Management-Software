import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { myRequests, pending, create, decide } from '../controllers/regularization.controller.js';

export const regularizationRouter = express.Router();

regularizationRouter.use(requireAuth);

// Everyone — their own requests / raise a request.
regularizationRouter.get('/me', myRequests);
regularizationRouter.post('/', create);

// Leadership (Director / CEO) — review + decide.
regularizationRouter.get('/', requirePermission('approveRegularization'), pending);
regularizationRouter.post('/:id/decide', requirePermission('approveRegularization'), decide);
