import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { checkIn, checkOut, today, list, overview, exportCsv, excuse } from '../controllers/attendance.controller.js';

export const attendanceRouter = express.Router();

attendanceRouter.use(requireAuth);

attendanceRouter.post('/check-in', requirePermission('markAttendance'), checkIn);
attendanceRouter.post('/check-out', requirePermission('markAttendance'), checkOut);
attendanceRouter.get('/today', today);
attendanceRouter.get('/overview', requirePermission('viewEveryone'), overview);
attendanceRouter.get('/export.csv', exportCsv);
attendanceRouter.post('/:id/excuse', requirePermission('approveRegularization'), excuse);
attendanceRouter.get('/', list);
