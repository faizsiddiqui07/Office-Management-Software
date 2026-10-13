import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { myRequests, pending, history, create, decide, remove, update, withdraw } from '../controllers/regularization.controller.js';

export const regularizationRouter = express.Router();

regularizationRouter.use(requireAuth);

// Everyone — their own requests / raise a request.
regularizationRouter.get('/me', myRequests);
regularizationRouter.post('/', create);
// Apni PENDING request badalna / wapas lena. Yahan koi permission nahi lagti —
// "ye meri hi request hai aur abhi tak pending hai" ki jaanch service me hai, kyunki
// wahi ek jagah hai jahan request ka asli maalik pata chalta hai.
regularizationRouter.put('/:id', update);
regularizationRouter.post('/:id/cancel', withdraw);

// Leadership (Director / CEO) — review + decide + history + delete a record.
regularizationRouter.get('/', requirePermission('approveRegularization'), pending);
regularizationRouter.get('/history', requirePermission('approveRegularization'), history);
regularizationRouter.post('/:id/decide', requirePermission('approveRegularization'), decide);
regularizationRouter.delete('/:id', requirePermission('approveRegularization'), remove);
