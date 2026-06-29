import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  getSettings,
  updateSettings,
  uploadLogo,
  removeLogo,
  uploadBackground,
  removeBackground,
} from '../controllers/settings.controller.js';

export const settingsRouter = express.Router();

settingsRouter.use(requireAuth);

// Readable by any authenticated user so the app can respect settings live.
settingsRouter.get('/', getSettings);
// Editable by leadership only.
settingsRouter.put('/', requirePermission('manageSettings'), updateSettings);
settingsRouter.post('/logo', requirePermission('manageSettings'), uploadLogo);
settingsRouter.delete('/logo', requirePermission('manageSettings'), removeLogo);
settingsRouter.post('/background', requirePermission('manageSettings'), uploadBackground);
settingsRouter.delete('/background', requirePermission('manageSettings'), removeBackground);
