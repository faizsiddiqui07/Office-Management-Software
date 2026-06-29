import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { catalog, options, list, create, update, remove } from '../controllers/roles.controller.js';

export const rolesRouter = express.Router();

rolesRouter.use(requireAuth);

// Any authed user may read the role options (for the user role dropdown).
rolesRouter.get('/options', options);

// Everything else — only roles with `manageRoles`.
rolesRouter.get('/catalog', requirePermission('manageRoles'), catalog);
rolesRouter.get('/', requirePermission('manageRoles'), list);
rolesRouter.post('/', requirePermission('manageRoles'), create);
rolesRouter.put('/:id', requirePermission('manageRoles'), update);
rolesRouter.delete('/:id', requirePermission('manageRoles'), remove);
