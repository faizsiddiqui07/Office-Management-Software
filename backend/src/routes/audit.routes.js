import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { listAudit } from '../controllers/audit.controller.js';

export const auditRouter = express.Router();

auditRouter.use(requireAuth, requirePermission('viewAudit'));
auditRouter.get('/', listAudit);
