import { ok, fail } from '../lib/apiResponse.js';
import { createTaskSchema, updateTaskSchema, statusSchema, listTasksQuerySchema, reviewTaskSchema, forwardTaskSchema, seenBulkSchema } from '../validators/tasks.validators.js';
import * as svc from '../services/task.service.js';
import { Setting } from '../models/Setting.js';
import { ymdInTz, formatCompany } from '../lib/time.js';
import { isOwnerRole } from '../lib/roles.js';
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
    // `users` = who they may hand work TO (access-controlled).
    // `taggable` = everyone, since tagging a colleague isn't giving them work.
    const [users, taggable] = await Promise.all([svc.assignableUsers(req.user), svc.taggableUsers(req.user)]);
    res.json(ok({ users, taggable }));
  } catch (err) {
    next(err);
  }
}

/**
 * The evening round-up for the owners: what everyone finished today.
 *
 * Returns `ready` so the client doesn't have to know the office's cut-off time, and
 * never returns anybody else's data to anybody else — it is owner-tier only.
 */
export async function eodDigest(req, res, next) {
  try {
    if (!isOwnerRole(req.user.role)) {
      return res.status(403).json(fail('FORBIDDEN', 'Only CEO & President see the daily round-up'));
    }
    const s = await Setting.getSingleton();
    const cfg = s.eodDigest || {};
    const after = /^\d{2}:\d{2}$/.test(cfg.time || '') ? cfg.time : '19:00';
    const enabled = cfg.enabled !== false;
    const today = ymdInTz(new Date());
    const nowHM = formatCompany(new Date(), 'HH:mm');

    // Before the cut-off there is nothing to show yet — say so rather than sending the
    // day's half-finished list, which the client would then have to sit on.
    if (!enabled || nowHM < after) {
      return res.json(ok({ ready: false, enabled, after, dateYMD: today, people: [], total: 0 }));
    }
    const digest = await svc.eodDigest(today);
    return res.json(ok({ ready: true, enabled, after, ...digest }));
  } catch (err) {
    return next(err);
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
    const { ids } = seenBulkSchema.parse(req.body ?? {});
    const result = await svc.markSeenBulk(req.user, ids);
    res.json(ok(result));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function forward(req, res, next) {
  try {
    const body = forwardTaskSchema.parse(req.body);
    const task = await svc.forwardTask(req.user, req.params.id, body);
    await audit({ actor: req.user._id, action: 'task.forward', entityType: 'Task', entityId: req.params.id, meta: { to: body.assignTo } });
    res.status(201).json(ok({ task }));
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

const PERIOD_LABELS = {
  week: 'completed in the last 7 days',
  month: 'completed in the last 30 days',
  year: 'completed in the last year',
  overdue: 'overdue',
  next7: 'due in the next 7 days',
  next30: 'due in the next 30 days',
};

export async function exportPdf(req, res, next) {
  try {
    const scope = req.query?.scope || 'all';
    const view = req.query?.view === 'assigned' ? 'assigned' : 'mine';
    const q = { scope: view, limit: 10000 };
    if (scope === 'pending') q.status = 'PENDING';
    else if (scope === 'completed') q.status = 'DONE';
    else if (['week', 'month', 'year'].includes(scope)) q.period = scope;

    // The PDF prints what the page is showing. The date range and the search box on the
    // To-Do page are sent along, so the download can't quietly disagree with the list
    // the person is looking at.
    const parts = [(SCOPE_LABELS[scope] || 'All tasks')];
    const { period, search, dateBasis } = req.query || {};
    if (['due', 'added', 'completed'].includes(dateBasis)) q.dateBasis = dateBasis;
    const basisWord = dateBasis === 'due' ? 'due' : dateBasis === 'completed' ? 'completed' : 'added';
    const ymdOnly = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
    const from = ymdOnly(req.query?.from);
    const to = ymdOnly(req.query?.to);
    if (from || to) {
      if (from) q.from = from;
      if (to) q.to = to;
      parts.push(from && to ? `${basisWord} ${from} → ${to}` : from ? `${basisWord} from ${from}` : `${basisWord} up to ${to}`);
    } else if (PERIOD_LABELS[period] && !q.period) {
      q.period = period;
      parts.push(PERIOD_LABELS[period]);
    }
    if (search) {
      q.search = String(search).slice(0, 200);
      parts.push(`matching “${q.search}”`);
    }

    const { tasks } = await svc.listTasks(req.user, q);
    const s = await Setting.getSingleton();
    const data = {
      company: { name: s.companyName, brandColor: s.brandColor },
      scopeLabel: parts.join(' · ') + (view === 'assigned' ? ' · assigned by me' : ''),
      for: view === 'assigned' ? null : req.user.name,
      // Company-time date — the raw ISO slice printed the UTC day, a day early in the
      // early-morning IST window, while the table's Created/Completed columns show IST.
      generatedAt: ymdInTz(new Date()),
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
