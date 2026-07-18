import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { meta, list, summary, exportCsv, create, update, remove } from '../controllers/expenses.controller.js';

export const expensesRouter = express.Router();

expensesRouter.use(requireAuth);

// Read — leadership, admin manager, accountant + managers (read-only oversight).
expensesRouter.get('/meta', requirePermission('viewExpenses'), meta);
expensesRouter.get('/summary', requirePermission('viewExpenses'), summary);
expensesRouter.get('/export.csv', requirePermission('viewExpenses'), exportCsv);
expensesRouter.get('/', requirePermission('viewExpenses'), list);

// Write — only the Admin Manager / Accountant / leadership.
expensesRouter.post('/', requirePermission('manageExpenses'), create);
expensesRouter.put('/:id', requirePermission('manageExpenses'), update);
expensesRouter.delete('/:id', requirePermission('manageExpenses'), remove);
