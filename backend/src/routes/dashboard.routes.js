import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { dashboard } from '../controllers/dashboard.controller.js';

export const dashboardRouter = express.Router();

dashboardRouter.use(requireAuth);
dashboardRouter.get('/', dashboard);
