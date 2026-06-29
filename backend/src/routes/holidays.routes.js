import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { list, create, update, remove } from '../controllers/holidays.controller.js';

export const holidaysRouter = express.Router();

holidaysRouter.use(requireAuth);

holidaysRouter.get('/', list); // everyone
holidaysRouter.post('/', requirePermission('editCalendar'), create);
holidaysRouter.put('/:id', requirePermission('editCalendar'), update);
holidaysRouter.delete('/:id', requirePermission('editCalendar'), remove);
