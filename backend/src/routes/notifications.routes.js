import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listNotifications, markRead, markAllRead } from '../controllers/notifications.controller.js';

export const notificationsRouter = express.Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get('/', listNotifications);
notificationsRouter.post('/read-all', markAllRead);
notificationsRouter.post('/:id/read', markRead);
