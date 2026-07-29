import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  preview,
  download,
  selfPreview,
  selfDownload,
  requireCompanyReports,
} from '../controllers/reports.controller.js';

export const reportsRouter = express.Router();

reportsRouter.use(requireAuth);
// The whole reports module is gated on "View / download reports" — the toggle used to
// control nothing (self reports were open to everyone), so revoking it did not restrict
// a thing. Company reports additionally need the leadership sections below.
reportsRouter.use(requirePermission('downloadReports'));

// Self-service — report on YOUR OWN data (still needs the reports permission above).
reportsRouter.get('/me/preview', selfPreview);
reportsRouter.get('/me', selfDownload);

// Company-wide — needs some company-data permission; sections are filtered per role.
reportsRouter.get('/:type/preview', requireCompanyReports, preview);
reportsRouter.get('/:type', requireCompanyReports, download);
