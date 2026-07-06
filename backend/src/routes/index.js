import express from 'express';
import { ok } from '../lib/apiResponse.js';
import { authRouter } from './auth.routes.js';
import { usersRouter } from './users.routes.js';
import { attendanceRouter } from './attendance.routes.js';
import { leavesRouter } from './leaves.routes.js';
import { announcementsRouter } from './announcements.routes.js';
import { notificationsRouter } from './notifications.routes.js';
import { holidaysRouter } from './holidays.routes.js';
import { expensesRouter } from './expenses.routes.js';
import { reportsRouter } from './reports.routes.js';
import { dashboardRouter } from './dashboard.routes.js';
import { settingsRouter } from './settings.routes.js';
import { auditRouter } from './audit.routes.js';
import { duesRouter } from './dues.routes.js';
import { pushRouter } from './push.routes.js';
import { regularizationRouter } from './regularization.routes.js';
import { rolesRouter } from './roles.routes.js';
import { visitorsRouter } from './visitors.routes.js';
import { tasksRouter } from './tasks.routes.js';
import { bonusRouter } from './bonus.routes.js';

/**
 * Root API router, mounted at /api in index.js.
 */
export const apiRouter = express.Router();

apiRouter.get('/health', (_req, res) => {
  res.json(
    ok({
      status: 'up',
      service: 'office-management-backend',
      build: 'login-fix-1', // bump to confirm a fresh deploy is live
      time: new Date().toISOString(),
    }),
  );
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/attendance', attendanceRouter);
apiRouter.use('/leaves', leavesRouter);
apiRouter.use('/announcements', announcementsRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/holidays', holidaysRouter);
apiRouter.use('/expenses', expensesRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/audit', auditRouter);
apiRouter.use('/dues', duesRouter);
apiRouter.use('/push', pushRouter);
apiRouter.use('/regularizations', regularizationRouter);
apiRouter.use('/roles', rolesRouter);
apiRouter.use('/visitors', visitorsRouter);
apiRouter.use('/tasks', tasksRouter);
apiRouter.use('/bonus', bonusRouter);

// ── Feature routers (added in later phases) ───────────────
// apiRouter.use('/leaves', leavesRouter);
// apiRouter.use('/announcements', announcementsRouter);
// apiRouter.use('/holidays', holidaysRouter);
// apiRouter.use('/expenses', expensesRouter);
// apiRouter.use('/reports', reportsRouter);
// apiRouter.use('/settings', settingsRouter);
// apiRouter.use('/notifications', notificationsRouter);
