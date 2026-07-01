import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { summary, assignable, list, create, setStatus, update, remove, exportPdf } from '../controllers/tasks.controller.js';

export const tasksRouter = express.Router();

// Personal to-do is available to every signed-in user; delegating is gated below.
tasksRouter.use(requireAuth);

tasksRouter.get('/summary', summary);
tasksRouter.get('/assignable', requirePermission('assignTasks'), assignable);
tasksRouter.get('/export.pdf', exportPdf);
tasksRouter.get('/', list);
tasksRouter.post('/', create); // assigning to others is permission + hierarchy checked in the service
tasksRouter.patch('/:id/status', setStatus);
tasksRouter.patch('/:id', update);
tasksRouter.delete('/:id', remove);
