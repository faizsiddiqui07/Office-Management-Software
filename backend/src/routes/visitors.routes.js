import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  meta,
  people,
  list,
  exportCsv,
  exportPdf,
  create,
  update,
  remove,
  addCategory,
  removeCategory,
} from '../controllers/visitors.controller.js';

export const visitorsRouter = express.Router();

visitorsRouter.use(requireAuth);

// Anyone with visitor-register access can log / view / export.
visitorsRouter.get('/meta', requirePermission('manageVisitors'), meta);
visitorsRouter.get('/people', requirePermission('manageVisitors'), people);
visitorsRouter.get('/export.csv', requirePermission('manageVisitors'), exportCsv);
visitorsRouter.get('/export.pdf', requirePermission('manageVisitors'), exportPdf);
visitorsRouter.get('/', requirePermission('manageVisitors'), list);
visitorsRouter.post('/', requirePermission('manageVisitors'), create);

// Category management — leadership only (company settings). Before /:id so
// DELETE /categories isn't captured by DELETE /:id.
visitorsRouter.post('/categories', requirePermission('manageSettings'), addCategory);
visitorsRouter.delete('/categories', requirePermission('manageSettings'), removeCategory);

visitorsRouter.put('/:id', requirePermission('manageVisitors'), update);
visitorsRouter.delete('/:id', requirePermission('manageVisitors'), remove);
