import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { validate } from '../middleware/validate.js';
import { createUserSchema, updateUserSchema } from '../validators/users.validators.js';
import { createUser, resetCredentials, listUsers, updateUser } from '../controllers/users.controller.js';

export const usersRouter = express.Router();

usersRouter.use(requireAuth);
usersRouter.get('/', requirePermission('viewEveryone'), listUsers);
usersRouter.post('/', requirePermission('createUsers'), validate(createUserSchema), createUser);
usersRouter.patch('/:id', requirePermission('manageUsers'), validate(updateUserSchema), updateUser);
usersRouter.post('/:id/reset-credentials', requirePermission('resetCredentials'), resetCredentials);
