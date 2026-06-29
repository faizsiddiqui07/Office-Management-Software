import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { list, activeUnseen, create, read, update, retire } from '../controllers/announcements.controller.js';

export const announcementsRouter = express.Router();

announcementsRouter.use(requireAuth);

announcementsRouter.get('/', list);
announcementsRouter.get('/active-unseen', activeUnseen);
announcementsRouter.post('/', requirePermission('postAnnouncements'), create);
announcementsRouter.post('/:id/read', read);
announcementsRouter.put('/:id', requirePermission('postAnnouncements'), update);
announcementsRouter.delete('/:id', requirePermission('postAnnouncements'), retire);
