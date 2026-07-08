import { Task } from '../models/Task.js';
import { User } from '../models/User.js';
import { notify } from '../models/Notification.js';
import { roleLabel } from '../lib/roles.js';
import { companyDayFromYMD } from '../lib/time.js';
import { onAssignedTaskDone, onAssignedTaskUndone } from './bonus.service.js';

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Can `actor` delegate a task to `target`? Purely per-person: leadership sets
 * each user's taskAssign access (Users → Edit) — NONE / ALL / SELECTED people.
 */
export function canAssignTo(actor, target) {
  if (String(actor._id) === String(target._id)) return false;
  const ta = actor.taskAssign || {};
  if (ta.mode === 'ALL') return true;
  if (ta.mode === 'SELECTED') return (ta.users || []).some((id) => String(id) === String(target._id));
  return false;
}

/** Whether the actor can assign work to anyone at all (drives the UI button). */
export function canAssignAny(actor) {
  const ta = actor.taskAssign || {};
  return ta.mode === 'ALL' || (ta.mode === 'SELECTED' && (ta.users || []).length > 0);
}

/** Active users the actor may assign tasks to (per canAssignTo above). */
export async function assignableUsers(actor) {
  const users = await User.find({ isActive: true, _id: { $ne: actor._id } }).select('name designation role').sort({ name: 1 });
  return users
    .filter((u) => canAssignTo(actor, u))
    .map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', role: u.role, roleLabel: roleLabel(u.role) }));
}

/**
 * Validate & normalise a list of collaborator ids the actor wants to tag on their
 * own task. Reuses the delegation ACL — you can only tag people you may assign
 * work to. Drops self, dedupes, and rejects the whole set if any id isn't allowed.
 */
async function resolveCollaborators(actor, ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const uniq = [...new Set(ids.map(String))].filter((id) => id !== String(actor._id));
  if (!uniq.length) return [];
  const users = await User.find({ _id: { $in: uniq }, isActive: true });
  const allowed = users.filter((u) => canAssignTo(actor, u));
  if (allowed.length !== uniq.length) {
    throw httpError(403, 'FORBIDDEN', 'You can only tag people you’re allowed to assign work to');
  }
  return allowed.map((u) => u._id);
}

/**
 * Create a task. Returns `{ tasks: [...] }` — one entry, except when delegating the
 * same work to several people at once (then one independent task per person).
 */
export async function createTask(actor, data) {
  // `assignTo` may be a single id or a list. Delegating to one or more people creates
  // an independent task each (each person owns and completes their own copy).
  const rawAssign = Array.isArray(data.assignTo) ? data.assignTo : data.assignTo ? [data.assignTo] : [];
  const assigneeIds = [...new Set(rawAssign.map(String))].filter((id) => id && id !== String(actor._id));

  if (assigneeIds.length) {
    const targets = await User.find({ _id: { $in: assigneeIds }, isActive: true });
    if (targets.length !== assigneeIds.length) throw httpError(404, 'NOT_FOUND', 'One of the selected people was not found');
    for (const t of targets) {
      if (!canAssignTo(actor, t)) {
        throw httpError(403, 'FORBIDDEN', 'You don’t have access to assign work to one of the selected people — ask leadership to grant it');
      }
    }

    const created = [];
    for (const target of targets) {
      const task = await Task.create({
        title: data.title,
        notes: data.notes || '',
        dueYMD: data.dueYMD || '',
        owner: target._id,
        assignedBy: actor._id,
        collaborators: [],
        status: 'PENDING',
      });
      await notify({
        user: target._id,
        type: 'TASK_ASSIGNED',
        title: `New task from ${actor.name}`,
        message: data.dueYMD ? `${data.title} (due ${data.dueYMD})` : data.title,
        link: '/todo',
      });
      await task.populate('owner', 'name');
      await task.populate('assignedBy', 'name');
      created.push(task.toJSON());
    }
    return { tasks: created };
  }

  // A personal task the actor keeps in their own to-do can tag teammates who are
  // also working on it (shared task) — they'll see it in "assigned to me".
  const collaborators = await resolveCollaborators(actor, data.collaborators);
  const task = await Task.create({
    title: data.title,
    notes: data.notes || '',
    dueYMD: data.dueYMD || '',
    owner: actor._id,
    assignedBy: null,
    collaborators,
    status: 'PENDING',
  });
  for (const cid of collaborators) {
    await notify({
      user: cid,
      type: 'TASK_ASSIGNED',
      title: `${actor.name} tagged you on a task`,
      message: data.dueYMD ? `${data.title} (due ${data.dueYMD})` : data.title,
      link: '/todo',
    });
  }

  await task.populate('owner', 'name');
  await task.populate('assignedBy', 'name');
  await task.populate('collaborators', 'name');
  return { tasks: [task.toJSON()] };
}

export async function setStatus(actor, id, status) {
  const task = await Task.findById(id);
  if (!task) throw httpError(404, 'NOT_FOUND', 'Task not found');
  const isOwner = String(task.owner) === String(actor._id);
  const isCollaborator = (task.collaborators || []).some((c) => String(c) === String(actor._id));
  // Shared tasks: the owner OR any tagged teammate can complete it (one status for all).
  if (!isOwner && !isCollaborator) throw httpError(403, 'FORBIDDEN', 'Only the task owner or a tagged teammate can update it');

  task.status = status === 'DONE' ? 'DONE' : 'PENDING';
  task.completedAt = task.status === 'DONE' ? new Date() : null;
  await task.save();

  if (task.status === 'DONE') {
    // Delegated task → tell the person who assigned it (existing behaviour).
    if (task.assignedBy && String(task.assignedBy) !== String(actor._id)) {
      await notify({ user: task.assignedBy, type: 'TASK_DONE', title: `${actor.name} completed a task`, message: task.title, link: '/todo?tab=assigned' });
    }
    // Shared task → tell everyone else on it (owner + other collaborators).
    const involved = new Set([String(task.owner), ...(task.collaborators || []).map(String)]);
    involved.delete(String(actor._id));
    for (const uid of involved) {
      await notify({ user: uid, type: 'TASK_DONE', title: `${actor.name} completed a shared task`, message: task.title, link: '/todo' });
    }
  }

  // Bonus points: award/penalise the assignee for an assigned task (best-effort —
  // never let a points hiccup block the actual task update).
  try {
    if (task.status === 'DONE') await onAssignedTaskDone(task);
    else await onAssignedTaskUndone(task._id);
  } catch (e) {
    console.error('bonus hook (setStatus) failed', e?.message);
  }

  await task.populate('owner', 'name');
  await task.populate('assignedBy', 'name');
  await task.populate('collaborators', 'name');
  return task.toJSON();
}

export async function updateTask(actor, id, data) {
  const task = await Task.findById(id);
  if (!task) throw httpError(404, 'NOT_FOUND', 'Task not found');
  const isOwner = String(task.owner) === String(actor._id);
  const isAssigner = task.assignedBy && String(task.assignedBy) === String(actor._id);
  // A delegated task can only be edited by the person who assigned it — the
  // assignee completes it (or asks), but can't change what was asked of them.
  if (task.assignedBy) {
    if (!isAssigner) throw httpError(403, 'ASSIGNED_TASK', 'This task was assigned to you — only the person who assigned it can edit it');
  } else if (!isOwner) {
    throw httpError(403, 'FORBIDDEN', 'You cannot edit this task');
  }

  for (const f of ['title', 'notes', 'dueYMD']) if (data[f] !== undefined) task[f] = data[f];

  // Only the owner of a non-delegated task manages its tagged teammates.
  if (data.collaborators !== undefined && isOwner && !task.assignedBy) {
    const before = new Set((task.collaborators || []).map(String));
    const resolved = await resolveCollaborators(actor, data.collaborators);
    task.collaborators = resolved;
    for (const cid of resolved) {
      if (!before.has(String(cid))) {
        await notify({ user: cid, type: 'TASK_ASSIGNED', title: `${actor.name} tagged you on a task`, message: task.dueYMD ? `${task.title} (due ${task.dueYMD})` : task.title, link: '/todo' });
      }
    }
  }

  await task.save();
  await task.populate('owner', 'name');
  await task.populate('assignedBy', 'name');
  await task.populate('collaborators', 'name');
  return task.toJSON();
}

export async function deleteTask(actor, id) {
  const task = await Task.findById(id);
  if (!task) throw httpError(404, 'NOT_FOUND', 'Task not found');
  const isOwner = String(task.owner) === String(actor._id);
  const isAssigner = task.assignedBy && String(task.assignedBy) === String(actor._id);
  // Delegated tasks can only be deleted by the person who assigned them — the
  // assignee must complete it (or ask the assigner), not make it disappear.
  if (task.assignedBy && !isAssigner) {
    throw httpError(403, 'ASSIGNED_TASK', 'This task was assigned to you — only the person who assigned it can delete it');
  }
  if (!isOwner && !isAssigner) throw httpError(403, 'FORBIDDEN', 'You cannot delete this task');
  await task.deleteOne();
  try { await onAssignedTaskUndone(task._id); } catch (e) { console.error('bonus hook (delete) failed', e?.message); }
  return { success: true };
}

function periodMatch(period, field = 'createdAt') {
  const days = period === 'week' ? 7 : period === 'month' ? 30 : period === 'year' ? 365 : 0;
  return days ? { [field]: { $gte: new Date(Date.now() - days * 86400000) } } : {};
}

export async function listTasks(actor, { scope = 'mine', status, search, period, from, to, page = 1, limit = 200 }) {
  const and = [];
  // "mine" now also includes shared tasks I'm tagged on (a collaborator), not just
  // ones I own — so multiple $or blocks may stack; combine them with $and.
  if (scope === 'assigned') and.push({ assignedBy: actor._id });
  else and.push({ $or: [{ owner: actor._id }, { collaborators: actor._id }] });
  if (status && ['PENDING', 'DONE'].includes(status)) and.push({ status });
  // Completed work filters on when it was completed; open work on when it was created.
  const dateField = status === 'DONE' ? 'completedAt' : 'createdAt';
  if (from || to) {
    // A custom date range (x → y) takes precedence over the preset period.
    const r = {};
    if (from) r.$gte = companyDayFromYMD(from);
    if (to) r.$lt = new Date(companyDayFromYMD(to).getTime() + 86400000); // through end of `to` day
    and.push({ [dateField]: r });
  } else {
    const pm = periodMatch(period, dateField);
    if (Object.keys(pm).length) and.push(pm);
  }
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    and.push({ $or: [{ title: rx }, { notes: rx }] });
  }
  const filter = and.length === 1 ? and[0] : { $and: and };

  const skip = (page - 1) * limit;
  const [tasks, total] = await Promise.all([
    Task.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('owner', 'name').populate('assignedBy', 'name').populate('collaborators', 'name'),
    Task.countDocuments(filter),
  ]);
  return { tasks: tasks.map((t) => t.toJSON()), total, page, limit };
}

export async function taskSummary(actor) {
  const [mine, assigned] = await Promise.all([
    Task.aggregate([{ $match: { $or: [{ owner: actor._id }, { collaborators: actor._id }] } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Task.aggregate([{ $match: { assignedBy: actor._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const pick = (agg, st) => agg.find((a) => a._id === st)?.n ?? 0;
  return {
    mine: { pending: pick(mine, 'PENDING'), done: pick(mine, 'DONE'), total: pick(mine, 'PENDING') + pick(mine, 'DONE') },
    assigned: { pending: pick(assigned, 'PENDING'), done: pick(assigned, 'DONE'), total: pick(assigned, 'PENDING') + pick(assigned, 'DONE') },
  };
}
