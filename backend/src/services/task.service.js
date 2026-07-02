import { Task } from '../models/Task.js';
import { User } from '../models/User.js';
import { notify } from '../models/Notification.js';

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
    .map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', role: u.role }));
}

export async function createTask(actor, data) {
  let owner = actor._id;
  let assignedBy = null;

  if (data.assignTo && String(data.assignTo) !== String(actor._id)) {
    const target = await User.findById(data.assignTo);
    if (!target || !target.isActive) throw httpError(404, 'NOT_FOUND', 'That user was not found');
    if (!canAssignTo(actor, target)) {
      throw httpError(403, 'FORBIDDEN', 'You don’t have access to assign work to this person — ask leadership to grant it');
    }
    owner = target._id;
    assignedBy = actor._id;
  }

  const task = await Task.create({
    title: data.title,
    notes: data.notes || '',
    dueYMD: data.dueYMD || '',
    owner,
    assignedBy,
    status: 'PENDING',
  });

  if (assignedBy) {
    await notify({
      user: owner,
      type: 'TASK_ASSIGNED',
      title: `New task from ${actor.name}`,
      message: data.dueYMD ? `${data.title} (due ${data.dueYMD})` : data.title,
      link: '/todo',
    });
  }

  await task.populate('owner', 'name');
  await task.populate('assignedBy', 'name');
  return task.toJSON();
}

export async function setStatus(actor, id, status) {
  const task = await Task.findById(id);
  if (!task) throw httpError(404, 'NOT_FOUND', 'Task not found');
  if (String(task.owner) !== String(actor._id)) throw httpError(403, 'FORBIDDEN', 'Only the task owner can update it');

  task.status = status === 'DONE' ? 'DONE' : 'PENDING';
  task.completedAt = task.status === 'DONE' ? new Date() : null;
  await task.save();

  if (task.status === 'DONE' && task.assignedBy) {
    await notify({
      user: task.assignedBy,
      type: 'TASK_DONE',
      title: `${actor.name} completed a task`,
      message: task.title,
      link: '/todo?tab=assigned',
    });
  }

  await task.populate('owner', 'name');
  await task.populate('assignedBy', 'name');
  return task.toJSON();
}

export async function updateTask(actor, id, data) {
  const task = await Task.findById(id);
  if (!task) throw httpError(404, 'NOT_FOUND', 'Task not found');
  const isOwner = String(task.owner) === String(actor._id);
  const isAssigner = task.assignedBy && String(task.assignedBy) === String(actor._id);
  if (!isOwner && !isAssigner) throw httpError(403, 'FORBIDDEN', 'You cannot edit this task');

  for (const f of ['title', 'notes', 'dueYMD']) if (data[f] !== undefined) task[f] = data[f];
  await task.save();
  await task.populate('owner', 'name');
  await task.populate('assignedBy', 'name');
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
  return { success: true };
}

function periodMatch(period, field = 'createdAt') {
  const days = period === 'week' ? 7 : period === 'month' ? 30 : period === 'year' ? 365 : 0;
  return days ? { [field]: { $gte: new Date(Date.now() - days * 86400000) } } : {};
}

export async function listTasks(actor, { scope = 'mine', status, search, period, page = 1, limit = 200 }) {
  const filter = scope === 'assigned' ? { assignedBy: actor._id } : { owner: actor._id };
  if (status && ['PENDING', 'DONE'].includes(status)) filter.status = status;
  // "Last 7 days" on completed work should mean completed-in-window, not created.
  Object.assign(filter, periodMatch(period, status === 'DONE' ? 'completedAt' : 'createdAt'));
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ title: rx }, { notes: rx }];
  }

  const skip = (page - 1) * limit;
  const [tasks, total] = await Promise.all([
    Task.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('owner', 'name').populate('assignedBy', 'name'),
    Task.countDocuments(filter),
  ]);
  return { tasks: tasks.map((t) => t.toJSON()), total, page, limit };
}

export async function taskSummary(actor) {
  const [mine, assigned] = await Promise.all([
    Task.aggregate([{ $match: { owner: actor._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Task.aggregate([{ $match: { assignedBy: actor._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const pick = (agg, st) => agg.find((a) => a._id === st)?.n ?? 0;
  return {
    mine: { pending: pick(mine, 'PENDING'), done: pick(mine, 'DONE'), total: pick(mine, 'PENDING') + pick(mine, 'DONE') },
    assigned: { pending: pick(assigned, 'PENDING'), done: pick(assigned, 'DONE'), total: pick(assigned, 'PENDING') + pick(assigned, 'DONE') },
  };
}
