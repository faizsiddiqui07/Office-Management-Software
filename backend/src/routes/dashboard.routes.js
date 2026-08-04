import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { dashboard, leaders } from '../controllers/dashboard.controller.js';

export const dashboardRouter = express.Router();

dashboardRouter.use(requireAuth);
dashboardRouter.get('/', dashboard);
dashboardRouter.get('/leaders', leaders); // task + overtime leaders for a chosen period
