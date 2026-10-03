import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { list, activeUnseen, create, read, reads, update, retire, audiencePeople } from '../controllers/announcements.controller.js';

export const announcementsRouter = express.Router();

announcementsRouter.use(requireAuth);

announcementsRouter.get('/', list);
announcementsRouter.get('/active-unseen', activeUnseen);
// Above the '/:id/...' routes so a literal path can never be read as an id.
// Same gate as posting: whoever can write an announcement can see who to address it to.
announcementsRouter.get('/audience/people', requirePermission('postAnnouncements'), audiencePeople);
announcementsRouter.post('/', requirePermission('postAnnouncements'), create);
announcementsRouter.post('/:id/read', read);
announcementsRouter.get('/:id/reads', requirePermission('postAnnouncements'), reads);
announcementsRouter.put('/:id', requirePermission('postAnnouncements'), update);
announcementsRouter.delete('/:id', requirePermission('postAnnouncements'), retire);
