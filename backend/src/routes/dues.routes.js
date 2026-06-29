import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import * as c from '../controllers/dues.controller.js';

export const duesRouter = express.Router();

duesRouter.use(requireAuth);

// Every user — their OWN ledger only.
duesRouter.get('/me', c.myDues);

// Admin Manager (manageDues) — everyone's ledger + mutations.
duesRouter.get('/overview', requirePermission('manageDues'), c.overview);
duesRouter.get('/export.csv', requirePermission('manageDues'), c.exportCsv);
duesRouter.get('/person/:id', requirePermission('manageDues'), c.personDues);
duesRouter.post('/due', requirePermission('manageDues'), c.addDue);
duesRouter.post('/payment', requirePermission('manageDues'), c.addPayment);
duesRouter.post('/settle', requirePermission('manageDues'), c.settle);
duesRouter.post('/settle-entry', requirePermission('manageDues'), c.settleEntry);
duesRouter.delete('/:id', requirePermission('manageDues'), c.removeEntry);
