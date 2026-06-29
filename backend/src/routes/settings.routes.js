import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  getSettings,
  getBranding,
  updateSettings,
  uploadLogo,
  removeLogo,
  uploadBackground,
  removeBackground,
} from '../controllers/settings.controller.js';

export const settingsRouter = express.Router();

// PUBLIC — branding only (logo + name + colour), so the login page (which is
// unauthenticated) can show the right logo. Must be BEFORE requireAuth.
settingsRouter.get('/branding', getBranding);

settingsRouter.use(requireAuth);

// Readable by any authenticated user so the app can respect settings live.
settingsRouter.get('/', getSettings);
// Editable by leadership only.
settingsRouter.put('/', requirePermission('manageSettings'), updateSettings);
settingsRouter.post('/logo', requirePermission('manageSettings'), uploadLogo);
settingsRouter.delete('/logo', requirePermission('manageSettings'), removeLogo);
settingsRouter.post('/background', requirePermission('manageSettings'), uploadBackground);
settingsRouter.delete('/background', requirePermission('manageSettings'), removeBackground);
