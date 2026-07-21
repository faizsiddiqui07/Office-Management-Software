import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { summary, assignable, list, create, setStatus, seen, review, update, remove, exportPdf } from '../controllers/tasks.controller.js';

export const tasksRouter = express.Router();

// Personal to-do is available to every signed-in user. Delegation access is PER
// PERSON (User.taskAssign, set by leadership in Users → Edit) — the service
// authorises every assign, so there is no role-permission gate here.
tasksRouter.use(requireAuth);

tasksRouter.get('/summary', summary);
tasksRouter.get('/assignable', assignable);
tasksRouter.get('/export.pdf', exportPdf);
tasksRouter.get('/', list);
tasksRouter.post('/', create); // assigning to others is access-checked in the service
tasksRouter.patch('/:id/status', setStatus);
tasksRouter.patch('/:id/seen', seen); // assignee opened it — read receipt
tasksRouter.patch('/:id/review', review); // assigner approves/rejects a submitted task
tasksRouter.patch('/:id', update);
tasksRouter.delete('/:id', remove);
