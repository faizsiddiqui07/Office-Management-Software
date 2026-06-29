import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  preview,
  download,
  selfPreview,
  selfDownload,
  requireCompanyReports,
} from '../controllers/reports.controller.js';

export const reportsRouter = express.Router();

reportsRouter.use(requireAuth);

// Self-service — every signed-in user can report on THEIR OWN data.
reportsRouter.get('/me/preview', selfPreview);
reportsRouter.get('/me', selfDownload);

// Company-wide — needs some company-data permission; sections are filtered per role.
reportsRouter.get('/:type/preview', requireCompanyReports, preview);
reportsRouter.get('/:type', requireCompanyReports, download);
