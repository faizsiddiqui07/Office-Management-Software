import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { validate } from '../middleware/validate.js';
import { createUserSchema, updateUserSchema, leaveBalanceSchema } from '../validators/users.validators.js';
import {
  createUser,
  resetCredentials,
  listUsers,
  updateUser,
  userDossier,
  getLeaveBalance,
  updateLeaveBalance,
} from '../controllers/users.controller.js';

export const usersRouter = express.Router();

usersRouter.use(requireAuth);
usersRouter.get('/', requirePermission('viewEveryone'), listUsers);
usersRouter.get('/:id/dossier', requirePermission('viewEveryone'), userDossier);
usersRouter.post('/', requirePermission('createUsers'), validate(createUserSchema), createUser);
usersRouter.patch('/:id', requirePermission('manageUsers'), validate(updateUserSchema), updateUser);
usersRouter.get('/:id/leave-balance', requirePermission('manageUsers'), getLeaveBalance);
usersRouter.patch('/:id/leave-balance', requirePermission('manageUsers'), validate(leaveBalanceSchema), updateLeaveBalance);
usersRouter.post('/:id/reset-credentials', requirePermission('resetCredentials'), resetCredentials);
