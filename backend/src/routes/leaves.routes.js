import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { balance, apply, update, record, list, decision, cancel, remove, leaveLedger, declareWfhDay, undoWfhDay, wfhDays, coverage } from '../controllers/leaves.controller.js';

export const leavesRouter = express.Router();

leavesRouter.use(requireAuth);

leavesRouter.get('/balance', balance);
leavesRouter.get('/ledger.pdf', leaveLedger); // own by default; ?userId= for leadership
// Office-wide work-from-home. Owner-tier only — enforced in the service, which resolves
// the owner tier by RANK so a role rename can't quietly open it up.
leavesRouter.get('/wfh/days', wfhDays);
leavesRouter.post('/wfh/declare', declareWfhDay);
leavesRouter.delete('/wfh/declare', undoWfhDay);
// Coverage clash warning shown to approvers reviewing a request — approver-gated because
// only they reach the queue, and it reveals who else is off.
leavesRouter.get('/coverage', requirePermission('approveLeave'), coverage);
leavesRouter.get('/', list);
leavesRouter.post('/', requirePermission('applyLeave'), apply);
leavesRouter.patch('/:id', requirePermission('applyLeave'), update); // owner + pending — enforced in service
leavesRouter.post('/record', requirePermission('approveLeave'), record); // leadership records leave FOR a user
leavesRouter.post('/:id/decision', requirePermission('approveLeave'), decision);
leavesRouter.post('/:id/cancel', cancel);
leavesRouter.delete('/:id', remove); // owner or approver; an approved leave must be cancelled first — enforced in service

export default leavesRouter;
