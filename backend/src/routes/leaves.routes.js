import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { balance, apply, update, record, list, decision, cancel, remove } from '../controllers/leaves.controller.js';

export const leavesRouter = express.Router();

leavesRouter.use(requireAuth);

leavesRouter.get('/balance', balance);
leavesRouter.get('/', list);
leavesRouter.post('/', requirePermission('applyLeave'), apply);
leavesRouter.patch('/:id', requirePermission('applyLeave'), update); // owner + pending — enforced in service
leavesRouter.post('/record', requirePermission('approveLeave'), record); // leadership records leave FOR a user
leavesRouter.post('/:id/decision', requirePermission('approveLeave'), decision);
leavesRouter.post('/:id/cancel', cancel);
leavesRouter.delete('/:id', remove); // owner or approver; an approved leave must be cancelled first — enforced in service

export default leavesRouter;
