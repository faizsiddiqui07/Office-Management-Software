import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pending, history, count } from '../controllers/approvals.controller.js';

export const approvalsRouter = express.Router();

// No permission gate here, and that is deliberate: the three sections scope
// themselves inside the service. Leave and corrections need their permission;
// tasks need only that you handed the work out yourself. Gating the whole router
// would hide the tasks section from everyone without leadership permissions —
// which is most of the people who actually delegate work.
approvalsRouter.use(requireAuth);

approvalsRouter.get('/', pending);
approvalsRouter.get('/history', history);
approvalsRouter.get('/count', count);
