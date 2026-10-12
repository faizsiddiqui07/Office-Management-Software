import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { checkIn, checkOut, today, list, overview, exportCsv, matrixCsv, setRecord, excuse, selfieSlip, selfieView } from '../controllers/attendance.controller.js';

export const attendanceRouter = express.Router();

attendanceRouter.use(requireAuth);

attendanceRouter.post('/check-in', requirePermission('markAttendance'), checkIn);
attendanceRouter.post('/check-out', requirePermission('markAttendance'), checkOut);
attendanceRouter.get('/today', today);
// Selfie se attendance (site par kaam karne walon ke liye).
// Upload ki parchi sirf usi ko jo attendance laga sakta hai; dekhne ka niyam service me
// hai — apni row hamesha, baaki tabhi jab viewEveryone ho (wahi niyam jo table ka hai).
attendanceRouter.post('/selfie-upload', requirePermission('markAttendance'), selfieSlip);
attendanceRouter.get('/:id/selfie/:which', selfieView);
attendanceRouter.get('/overview', requirePermission('viewEveryone'), overview);
attendanceRouter.get('/export.csv', exportCsv);
attendanceRouter.get('/matrix.csv', requirePermission('viewEveryone'), matrixCsv);
attendanceRouter.put('/record', requirePermission('approveRegularization'), setRecord);
attendanceRouter.post('/:id/excuse', requirePermission('approveRegularization'), excuse);
attendanceRouter.get('/', list);
