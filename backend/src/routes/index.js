import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { ok } from '../lib/apiResponse.js';
import { authRouter } from './auth.routes.js';
import { usersRouter } from './users.routes.js';
import { attendanceRouter } from './attendance.routes.js';
import { leavesRouter } from './leaves.routes.js';
import { announcementsRouter } from './announcements.routes.js';
import { badgesRouter } from './badges.routes.js';
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

/**
 * Which build is actually running. `src/build-info.json` is written by
 * scripts/package-lambda.mjs from the commit it packaged, and is gitignored — so this
 * reports a real commit in a deployed zip and "dev" from a working copy. Read once at
 * module load; it cannot change while the process lives.
 */
const BUILD = (() => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(fs.readFileSync(path.join(here, '..', 'build-info.json'), 'utf8'));
  } catch {
    return { commit: 'dev', subject: '', builtAt: null };
  }
})();

apiRouter.get('/health', (_req, res) => {
  res.json(
    ok({
      status: 'up',
      service: 'office-management-backend',
      // Compare `build` against `git log -1 --pretty=%h` to tell whether the zip you
      // just uploaded is the one answering.
      build: BUILD.commit,
      builtAt: BUILD.builtAt,
      subject: BUILD.subject || undefined,
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
apiRouter.use('/badges', badgesRouter);
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
