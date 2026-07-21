import { ok, fail } from '../lib/apiResponse.js';
import { createTaskSchema, updateTaskSchema, statusSchema, listTasksQuerySchema, reviewTaskSchema } from '../validators/tasks.validators.js';
import * as svc from '../services/task.service.js';
import { Setting } from '../models/Setting.js';
import { audit } from '../models/AuditLog.js';
import { renderTasksPdf } from '../services/taskPdf.service.js';
import { loadCompanyLogo } from '../lib/brand.js';

function handleErr(res, err, next) {
  if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
  return next(err);
}

export async function summary(req, res, next) {
  try {
    res.json(ok(await svc.taskSummary(req.user)));
  } catch (err) {
    next(err);
  }
}

export async function assignable(req, res, next) {
  try {
    res.json(ok({ users: await svc.assignableUsers(req.user) }));
  } catch (err) {
    next(err);
  }
}

export async function list(req, res, next) {
  try {
    const q = listTasksQuerySchema.parse(req.query);
    res.json(ok(await svc.listTasks(req.user, q)));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function create(req, res, next) {
  try {
    const body = createTaskSchema.parse(req.body);
    const { tasks } = await svc.createTask(req.user, body);
    for (const t of tasks) {
      await audit({ actor: req.user._id, action: 'task.create', entityType: 'Task', entityId: t.id, meta: { assigned: !!t.assignedBy } });
    }
    res.status(201).json(ok({ task: tasks[0], tasks, count: tasks.length }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function setStatus(req, res, next) {
  try {
    const { status } = statusSchema.parse(req.body);
    const task = await svc.setStatus(req.user, req.params.id, status);
    res.json(ok({ task }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function seen(req, res, next) {
  try {
    const task = await svc.markSeen(req.user, req.params.id);
    res.json(ok({ task }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function seenBulk(req, res, next) {
  try {
    const result = await svc.markSeenBulk(req.user, req.body?.ids);
    res.json(ok(result));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function review(req, res, next) {
  try {
    const { approve, reason } = reviewTaskSchema.parse(req.body);
    const task = await svc.reviewTask(req.user, req.params.id, approve, reason);
    res.json(ok({ task }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function update(req, res, next) {
  try {
    const body = updateTaskSchema.parse(req.body);
    const task = await svc.updateTask(req.user, req.params.id, body);
    res.json(ok({ task }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function remove(req, res, next) {
  try {
    await svc.deleteTask(req.user, req.params.id);
    res.json(ok({ success: true }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

const SCOPE_LABELS = {
  all: 'All tasks',
  pending: 'Pending',
  completed: 'Completed',
  week: 'Last 7 days',
  month: 'Last 30 days',
  year: 'Last year',
};

export async function exportPdf(req, res, next) {
  try {
    const scope = req.query?.scope || 'all';
    const view = req.query?.view === 'assigned' ? 'assigned' : 'mine';
    const q = { scope: view, limit: 10000 };
    if (scope === 'pending') q.status = 'PENDING';
    else if (scope === 'completed') q.status = 'DONE';
    else if (['week', 'month', 'year'].includes(scope)) q.period = scope;

    const { tasks } = await svc.listTasks(req.user, q);
    const s = await Setting.getSingleton();
    const data = {
      company: { name: s.companyName, brandColor: s.brandColor },
      scopeLabel: (SCOPE_LABELS[scope] || 'All tasks') + (view === 'assigned' ? ' · assigned by me' : ''),
      for: view === 'assigned' ? null : req.user.name,
      generatedAt: new Date().toISOString().slice(0, 10),
      tasks,
    };
    const logo = loadCompanyLogo(s.logoDark || s.logoUrl || s.logoLight);
    const stream = await renderTasksPdf(data, logo);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="tasks-${scope}.pdf"`);
    stream.pipe(res);
  } catch (err) {
    handleErr(res, err, next);
  }
}
