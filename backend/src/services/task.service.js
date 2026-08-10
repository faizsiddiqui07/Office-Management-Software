import { randomUUID } from 'node:crypto';
import { Task } from '../models/Task.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { notify, clearNotificationsFor } from '../models/Notification.js';
import { roleLabel, isOwnerRole } from '../lib/roles.js';
import { gateFrozen } from '../lib/pointsGate.js';
import { can } from '../lib/permissions.js';
import { companyDayFromYMD, ymdInTz, COMPANY_TZ } from '../lib/time.js';
import { onAssignedTaskDone, onAssignedTaskUndone, rebuildOverdueForTask } from './bonus.service.js';

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
 * A notification link that opens the EXACT task, not just the To-Do page. The client
 * reads `?task=<id>` and pops that task's detail dialog on the right tab. `assigned` picks
 * the "Assigned by me" tab (for the person who handed the work out); everyone else lands
 * on "My tasks". A removed task has no id to open, so it falls back to the plain page.
 */
const todoLink = (id, assigned = false) =>
  (id ? `/todo?${assigned ? 'tab=assigned&' : ''}task=${id}` : assigned ? '/todo?tab=assigned' : '/todo');

/**
 * The same link for a TAGGED colleague. Their task lives on its own tab now, and each
 * tab loads its own list — without the tab the notification would land on "My tasks",
 * whose list no longer contains the task, and the detail dialog would never open.
 */
const taggedLink = (id) => (id ? `/todo?tab=tagged&task=${id}` : '/todo?tab=tagged');

/**
 * The end-of-day round-up: who finished what TODAY, person by person.
 *
 * Read live off the tasks every time it's asked for — nothing is stored, nothing is
 * kept. The owners see it once in the evening and it is gone; the only thing recorded
 * anywhere is a flag in their own browser saying they've closed today's.
 *
 * A task counts on the day the person actually DID it — for an approval task that's the
 * day they submitted, not the day it was signed off — the same rule the leaderboard and
 * the bonus system use, so the three never tell different stories. Copies that were
 * forwarded onward are left out: finishing at the bottom of a chain marks every copy
 * above it done as well, and one piece of work should appear once.
 */
export async function eodDigest(dateYMD) {
  const forwardedParentIds = await Task.distinct('forwardedFrom', { forwardedFrom: { $ne: null } });
  const rows = await Task.aggregate([
    { $match: { status: 'DONE', completedAt: { $ne: null }, _id: { $nin: forwardedParentIds } } },
    { $addFields: { doneYMD: { $dateToString: { date: '$completedAt', format: '%Y-%m-%d', timezone: COMPANY_TZ } } } },
    { $match: { doneYMD: dateYMD } },
    { $group: { _id: { $ifNull: ['$completedBy', '$owner'] }, titles: { $push: '$title' } } },
  ]);
  if (!rows.length) return { dateYMD, people: [], total: 0 };

  const users = await User.find({ _id: { $in: rows.map((r) => r._id) } }).select('name employeeId').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const people = rows
    .map((r) => ({
      name: byId.get(String(r._id))?.name ?? '—',
      employeeId: byId.get(String(r._id))?.employeeId ?? '',
      tasks: r.titles,
    }))
    .filter((p) => p.name !== '—')
    // Most done first, then alphabetically — the list reads as a ranking, not a dump.
    .sort((a, b) => b.tasks.length - a.tasks.length || a.name.localeCompare(b.name));

  return { dateYMD, people, total: people.reduce((s, p) => s + p.tasks.length, 0) };
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
    .map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', role: u.role, roleLabel: roleLabel(u.role), isOwner: isOwnerRole(u.role) }));
}

/**
 * Everyone in the office, for tagging — anyone can be a colleague on a task.
 * `isOwner` marks the CEO & President tier, so the assign dialog can tell the assigner
 * whether the task will count for points (resolved by ROLE here, never by a role name
 * hard-coded in the client).
 */
export async function taggableUsers(actor) {
  const users = await User.find({ isActive: true, _id: { $ne: actor._id } }).select('name designation role').sort({ name: 1 });
  return users.map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', role: u.role, roleLabel: roleLabel(u.role), isOwner: isOwnerRole(u.role) }));
}

/**
 * Validate & normalise a list of colleague ids the actor wants to tag on their own
 * task. Deliberately NOT the delegation ACL: tagging says "this person is working on
 * this with me", which is a fact about who is involved, not an instruction — so anyone
 * in the office can be tagged, while handing work TO someone still needs assign access.
 * Drops self, dedupes, and rejects the whole set if an id isn't a real active person.
 *
 * `alreadyOn` — people already tagged on this task. They stay even if they have since
 * been deactivated: an edit dialog sends the whole list back, so demanding that every
 * name still be active meant one departed colleague froze the task forever ("one of the
 * people you tagged was not found", with nothing on screen to tell you who). Same rule
 * the reassignment path already uses for existing assignees. Newly added names must of
 * course be real and active.
 */
async function resolveCollaborators(actor, ids, alreadyOn = []) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const uniq = [...new Set(ids.map(String))].filter((id) => id !== String(actor._id));
  if (!uniq.length) return [];
  const users = await User.find({ _id: { $in: uniq } }).select('_id isActive');
  const keep = new Set(alreadyOn.map(String));
  if (users.length !== uniq.length || users.some((u) => !u.isActive && !keep.has(String(u._id)))) {
    throw httpError(404, 'NOT_FOUND', 'One of the people you tagged was not found');
  }
  return users.map((u) => u._id);
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

    // Link the copies only when there are 2+ — so the assigner can later edit them
    // all at once. A lone delegate has no siblings, so no batch.
    const batch = targets.length > 1 ? randomUUID() : '';

    // Tagged colleagues are for awareness, not for doing the work — anyone in the
    // office can be tagged (a CEO too), same rule as a personal task. They ride on
    // every copy so a tagged person sees the work whoever it was handed to.
    const collaborators = (await resolveCollaborators(actor, data.collaborators))
      .filter((cid) => !assigneeIds.includes(String(cid))); // an assignee isn't also a bystander

    const created = [];
    for (const target of targets) {
      const task = await Task.create({
        title: data.title,
        notes: data.notes || '',
        dueYMD: data.dueYMD || '',
        owner: target._id,
        assignedBy: actor._id,
        collaborators,
        assignBatch: batch,
        requiresApproval: !!data.requiresApproval,
        status: 'PENDING',
      });
      await notify({
        user: target._id,
        type: 'TASK_ASSIGNED',
        title: `New task from ${actor.name}`,
        message: data.dueYMD ? `${data.title} (due ${data.dueYMD})` : data.title,
        link: todoLink(task._id),
      });
      await task.populate('owner', 'name');
      await task.populate('assignedBy', 'name');
      created.push(task.toJSON());
    }
    // Tell each tagged person ONCE, not once per assignee copy. They see it in "Shared
    // with me"; open the first copy (the tag rides every copy of a multi-assign batch).
    for (const cid of collaborators) {
      await notify({
        user: cid,
        type: 'TASK_ASSIGNED',
        title: `${actor.name} tagged you on a task`,
        message: data.title,
        link: taggedLink(created[0]?.id),
      });
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
      link: taggedLink(task._id),
    });
  }

  await task.populate('owner', 'name');
  await task.populate('assignedBy', 'name');
  await task.populate('collaborators', 'name');
  return { tasks: [task.toJSON()] };
}

async function populated(task) {
  await task.populate('owner', 'name');
  await task.populate('assignedBy', 'name');
  await task.populate('collaborators', 'name');
  await task.populate('completedBy', 'name');
  await task.populate('approvedBy', 'name');
  await task.populate('originalAssignedBy', 'name');
  return task.toJSON();
}

/**
 * One task, fully populated, for a detail view (e.g. clicking a task on the Rewards
 * page). Readable by anyone connected to the task — its owner, assigner, a collaborator,
 * whoever completed or approved it, the person who first set it in motion — or by
 * leadership who can see everyone's work. Everyone else is refused, so a task id can't be
 * probed for someone else's private notes.
 */
export async function getTaskDetail(actor, id) {
  const task = await Task.findById(id);
  if (!task) throw httpError(404, 'NOT_FOUND', 'Task not found');
  const me = String(actor._id);
  const linked = [task.owner, task.assignedBy, task.completedBy, task.approvedBy, task.originalAssignedBy]
    .filter(Boolean)
    .map(String);
  const isCollaborator = (task.collaborators || []).some((c) => String(c) === me);
  const canSeeAll = can(actor, 'viewEveryone') || can(actor, 'manageSettings');
  if (!linked.includes(me) && !isCollaborator && !canSeeAll) {
    throw httpError(403, 'FORBIDDEN', 'You don’t have access to this task');
  }
  return populated(task);
}

export async function setStatus(actor, id, status) {
  const task = await Task.findById(id);
  if (!task) throw httpError(404, 'NOT_FOUND', 'Task not found');
  const isOwner = String(task.owner) === String(actor._id);
  const isCollaborator = (task.collaborators || []).some((c) => String(c) === String(actor._id));
  const isAssigner = task.assignedBy && String(task.assignedBy) === String(actor._id);
  // On a shared PERSONAL task (no assigner) a tagged teammate co-owns it — whoever
  // finishes it closes it for everyone. But on a DELEGATED task, tagging is only for
  // awareness: the assignee does the work, so a collaborator must NOT be able to
  // complete it (bypassing the assignee and the approval gate) or reopen it.
  // A task whose assigner was DELETED still isn't personal — `assignedBy` is only null
  // because the reference had to be cleared. Without the second test a tagged teammate
  // inherited co-ownership of somebody else's delegated work the moment an account was
  // removed, and could reopen it: that path runs onAssignedTaskUndone, which deletes the
  // assignee's point entries, and the rebuild that normally re-prices them bails out on
  // a task with no assigner — so the doer's points were gone for good.
  const sharedPersonal = !task.assignedBy && !gateFrozen(task);
  if (!isOwner && !(isCollaborator && sharedPersonal)) {
    throw httpError(403, 'FORBIDDEN', 'Only the task owner can update this task');
  }

  const wantDone = status === 'DONE';

  // ── No-op guard ──────────────────────────────────────────
  // Asking for the status it already has is not a state change, and it must not be
  // treated as one. Two real bugs lived here:
  //  - PENDING -> PENDING fell through to the "reopen" branch and ran
  //    onAssignedTaskUndone, which DELETES the task's point entries. An assignee could
  //    call it daily to wipe their own accumulated overdue drips (the daily scan only
  //    re-writes the mark and TODAY's drip, so the older days were gone for good).
  //  - DONE -> DONE overwrote completedAt/completedBy, so a retry or double-tap after
  //    the deadline re-scored an on-time award into a late penalty, and on a forwarded
  //    copy it replaced the real doer with whoever tapped.
  // A submitted task is excluded: "done" on it is the withdraw/resubmit flow below.
  if (!task.awaitingApproval && ((wantDone && task.status === 'DONE') || (!wantDone && task.status === 'PENDING'))) {
    return populated(task);
  }

  // ── Work handed further down ─────────────────────────────
  // A copy that was forwarded is not this person's to finish: the chain closes when the
  // person they forwarded to finishes (settleParent walks it up). Without this guard the
  // forwarder could mark their own copy done and the payout would pay the WHOLE tree,
  // including a junior whose copy is still pending — points for work nobody did.
  if (wantDone) {
    const openChild = await Task.findOne({ forwardedFrom: task._id, status: { $ne: 'DONE' } }).select('_id');
    if (openChild) {
      throw httpError(409, 'FORWARDED_OPEN', 'You forwarded this task — it closes when the person you forwarded it to finishes');
    }
  }

  // Approval gate: when the assigner required approval, the assignee marking "done"
  // SUBMITS for review instead of closing it. It sits as "awaiting approval" until the
  // assigner approves/rejects (reviewTask). The submit time is the on-time reference so
  // a slow approval never turns on-time work into "late".
  if (wantDone && task.requiresApproval && task.assignedBy && isOwner && task.status !== 'DONE') {
    // Already submitted? Re-submitting would reset its place in the approver's queue and
    // send them a duplicate notification.
    if (task.submittedAt) return populated(task);
    task.submittedAt = new Date();
    task.rejectionReason = '';
    await task.save();
    await notify({
      user: task.assignedBy,
      // Its own type (not TASK_ASSIGNED, which also means "new task"/"tagged you") so
      // withdrawing/deciding can clear THIS without touching the assignment notice.
      type: 'TASK_APPROVAL',
      title: `${actor.name} submitted work for approval`,
      message: task.title,
      link: todoLink(task._id, true),
      entityType: 'Task',
      entityId: task._id,
    });
    return populated(task);
  }

  // Withdraw a pending submission (assignee pulls it back before it's reviewed).
  if (!wantDone && task.awaitingApproval) {
    task.submittedAt = null;
    await task.save();
    // Pulled back before review — take "approve this" out of the assigner's bell.
    await clearNotificationsFor('Task', task._id, { types: ['TASK_APPROVAL'] });
    return populated(task);
  }

  task.status = wantDone ? 'DONE' : 'PENDING';
  task.completedAt = wantDone ? new Date() : null;
  task.completedBy = wantDone ? actor._id : null;
  if (!wantDone) { task.submittedAt = null; task.approvedBy = null; } // reopening clears the submission/approval trail

  await task.save();

  if (task.status === 'DONE') {
    if (task.assignedBy && !isAssigner) {
      await notify({ user: task.assignedBy, type: 'TASK_DONE', title: `${actor.name} completed a task`, message: task.title, link: todoLink(task._id, true) });
    }
    // Legacy shared "collaborator" task (single doc, tagged teammates) → tell the others.
    const involved = new Set([String(task.owner), ...(task.collaborators || []).map(String)]);
    involved.delete(String(actor._id));
    for (const uid of involved) {
      await notify({ user: uid, type: 'TASK_DONE', title: `${actor.name} completed a shared task`, message: task.title, link: todoLink(task._id) });
    }
  }

  // Bonus points: award/penalise the assignee (best-effort — a points hiccup must never
  // block the task update).
  try {
    if (task.status === 'DONE') await onAssignedTaskDone(task);
    else await onAssignedTaskUndone(task._id);
  } catch (e) {
    console.error('bonus hook (setStatus) failed', e?.message);
  }

  // Finishing forwarded work settles the copy it came from — through that person's
  // own approval if one was asked for. Best-effort: their chain must never block this.
  if (task.status === 'DONE') {
    try { await settleParent(task); } catch (e) { console.error('forward settle failed', e?.message); }
  }

  return populated(task);
}

/**
 * The assigner reviews an approval-required task the assignee has submitted:
 * approve → it's DONE (credited to the assignee, on-time judged from the approval day),
 * reject → back to the assignee's to-do with the reason.
 */
export async function reviewTask(actor, id, approve, reason) {
  const task = await Task.findById(id);
  if (!task) throw httpError(404, 'NOT_FOUND', 'Task not found');
  const isAssigner = task.assignedBy && String(task.assignedBy) === String(actor._id);
  if (!isAssigner) throw httpError(403, 'FORBIDDEN', 'Only the person who assigned this task can review it');
  if (!task.awaitingApproval) throw httpError(400, 'NOT_AWAITING', 'This task isn’t waiting for approval');
  // Approving a copy that was forwarded onward would settle (and pay) the whole chain
  // while the person below is still working — the same overpayment the DONE guard in
  // setStatus blocks. The submission has to wait for the work underneath it.
  if (approve) {
    const openChild = await Task.findOne({ forwardedFrom: task._id, status: { $ne: 'DONE' } }).select('_id');
    if (openChild) {
      throw httpError(409, 'FORWARDED_OPEN', 'This was forwarded onward — it can be approved once the person below finishes');
    }
  }

  // Reviewing it (either way) spends the "approve this" — clear it so it doesn't linger
  // in the assigner's own bell after they've acted.
  await clearNotificationsFor('Task', task._id, { types: ['TASK_APPROVAL'] });

  if (approve) {
    task.status = 'DONE';
    task.completedAt = new Date();
    // Normally the assignee did it. For forwarded work the real doer was already
    // recorded further down the chain, so never overwrite it.
    task.completedBy = task.completedBy || task.owner;
    task.approvedBy = actor._id;
    task.rejectionReason = '';
    await task.save();
    await notify({ user: task.owner, type: 'TASK_DONE', title: `${actor.name} approved your task`, message: task.title, link: todoLink(task._id) });
    try { await onAssignedTaskDone(task); } catch (e) { console.error('bonus hook (approve) failed', e?.message); }
    // An approval can be the last link needed to settle the copy above it.
    try { await settleParent(task); } catch (e) { console.error('forward settle failed', e?.message); }
  } else {
    task.submittedAt = null; // back to plain pending, with the reason attached
    task.rejectionReason = String(reason || '').trim();
    await task.save();
    await notify({
      user: task.owner,
      type: 'TASK_ASSIGNED',
      title: `${actor.name} sent your task back`,
      message: task.rejectionReason ? `${task.title} — ${task.rejectionReason}` : task.title,
      link: todoLink(task._id),
    });
  }
  return populated(task);
}

/**
 * The assignee has opened and read a task they were given. Recorded once, the first
 * time — a "read receipt" so the person who assigned it can tell the difference
 * between work that was delivered and work that was actually seen.
 *
 * Only the person it was assigned TO can mark it, and only on delegated work: marking
 * your own note as read would mean nothing. Silent no-op otherwise, since this fires
 * from simply opening a task and must never interrupt anyone.
 */
export async function markSeen(actor, id) {
  const task = await Task.findById(id);
  if (!task) throw httpError(404, 'NOT_FOUND', 'Task not found');
  const isOwner = String(task.owner) === String(actor._id);
  // Not yours to read. This used to fall through to the silent no-op below and hand
  // back the fully populated task, so anyone could read any task — title, notes (which
  // can carry client and site detail), and the whole chain — just by asking to mark it
  // seen. Every other task endpoint checks ownership; this one has to as well.
  if (!isOwner) throw httpError(403, 'FORBIDDEN', 'You cannot open a task that was not assigned to you');
  // Yours, but nothing to record: your own note, or a receipt already stamped.
  if (!task.assignedBy || task.seenAt) return populated(task);
  task.seenAt = new Date();
  await task.save();
  return populated(task);
}

/**
 * The same read receipt for a whole screenful at once — seeing a task listed counts as
 * having seen it, so the list marks everything it just showed you in one request
 * instead of one per task.
 *
 * The filter is the guard: only tasks assigned TO this person, only delegated ones, and
 * only those not already seen — so passing extra ids can never mark someone else's work
 * or rewrite a timestamp.
 */
export async function markSeenBulk(actor, ids) {
  const list = (Array.isArray(ids) ? ids : []).filter(Boolean).slice(0, 10000);
  if (!list.length) return { seen: 0 };
  const res = await Task.updateMany(
    { _id: { $in: list }, owner: actor._id, assignedBy: { $ne: null }, seenAt: null },
    { $set: { seenAt: new Date() } },
  );
  return { seen: res.modifiedCount || 0 };
}

/**
 * Pass work you were given further down, without dropping it. The copy you were
 * assigned stays in your list — you're still answerable for it to whoever gave it to
 * you — and it closes only when the person you forwarded to finishes AND every
 * approval up the chain is satisfied (see settleParent).
 *
 * Forwarding is delegating, so it needs the same access as assigning. The original
 * source is carried down so the new owner can always see where the work came from.
 */
export async function forwardTask(actor, id, { assignTo, requiresApproval, notes } = {}) {
  const parent = await Task.findById(id);
  if (!parent) throw httpError(404, 'NOT_FOUND', 'Task not found');
  if (String(parent.owner) !== String(actor._id)) {
    throw httpError(403, 'FORBIDDEN', 'You can only forward a task that was given to you');
  }
  if (parent.status === 'DONE') throw httpError(409, 'ALREADY_DONE', 'This task is already done');
  // A personal to-do has no chain to settle into: the copy would be delegated work that
  // can never be paid (the payout is judged on the ROOT, and a personal root pays
  // nobody), while the junior still collects overdue penalties on it. Give it away as a
  // real assignment instead.
  if (!parent.assignedBy) {
    throw httpError(400, 'PERSONAL_TASK', 'This is your own to-do — assign it as a task instead of forwarding it');
  }
  // Submitted work is already with the approver. Forwarding it would leave the same task
  // sitting in their queue AND live below, and approving it would pay a chain whose
  // bottom is still pending. Pull the submission back first.
  if (parent.submittedAt) {
    throw httpError(409, 'AWAITING_APPROVAL', 'This is waiting for approval — withdraw the submission before forwarding it');
  }

  const target = await User.findById(assignTo);
  if (!target || !target.isActive) throw httpError(404, 'NOT_FOUND', 'That person was not found');
  if (!canAssignTo(actor, target)) {
    throw httpError(403, 'FORBIDDEN', 'You don’t have access to assign work to this person — ask leadership to grant it');
  }
  // Never hand the work back up the line it came down. Sending it to the person who
  // gave it to you (or to whoever started it) isn't delegating, it's a loop.
  const upstream = [parent.assignedBy, parent.originalAssignedBy].filter(Boolean).map(String);
  if (upstream.includes(String(target._id))) {
    throw httpError(403, 'FORBIDDEN', 'You can’t forward this back to the person who gave it to you');
  }
  const already = await Task.findOne({ forwardedFrom: parent._id, owner: target._id, status: { $ne: 'DONE' } });
  if (already) throw httpError(409, 'ALREADY_FORWARDED', 'You have already forwarded this task to them');

  const child = await Task.create({
    title: parent.title,
    notes: notes !== undefined ? notes : parent.notes,
    dueYMD: parent.dueYMD,
    owner: target._id,
    assignedBy: actor._id,
    forwardedFrom: parent._id,
    originalAssignedBy: parent.originalAssignedBy || parent.assignedBy || null,
    requiresApproval: !!requiresApproval,
    status: 'PENDING',
  });

  // The parent copy is now a forwarder, not a doer — drop any overdue penalty it had picked
  // up while it sat in their list. Their reward now comes from the chain settling (a
  // forwarder bonus), scored on the root when the whole chain is finally approved.
  try { await onAssignedTaskUndone(parent._id); } catch (e) { console.error('bonus hook (forward) failed', e?.message); }

  await notify({
    user: target._id,
    type: 'TASK_ASSIGNED',
    title: `${actor.name} forwarded a task to you`,
    message: parent.dueYMD ? `${parent.title} (due ${parent.dueYMD})` : parent.title,
    link: todoLink(child._id),
  });
  return populated(child);
}

/**
 * A forwarded task just closed — carry that up to the copy it came from.
 *
 * The parent doesn't simply close: if its own assigner asked for approval it goes to
 * them for review first, exactly as if the parent's owner had finished it themselves.
 * So a chain settles one link at a time, honouring each approval that was switched on
 * and skipping the ones that weren't. Credit for the work stays with whoever actually
 * did it, all the way up.
 */
async function settleParent(childTask, depth = 0) {
  if (!childTask.forwardedFrom || depth > 10) return; // depth guard: never loop a chain
  const parent = await Task.findById(childTask.forwardedFrom);
  if (!parent || parent.status === 'DONE') return;

  // Any other live forward of the same parent still outstanding? Then it isn't finished.
  const siblingOpen = await Task.findOne({
    forwardedFrom: parent._id,
    _id: { $ne: childTask._id },
    status: { $ne: 'DONE' },
  });
  if (siblingOpen) return;

  const doer = childTask.completedBy || childTask.owner;

  if (parent.requiresApproval && parent.assignedBy) {
    // Their assigner wanted to approve — hand it over rather than closing it.
    if (!parent.submittedAt) {
      parent.submittedAt = new Date();
      parent.rejectionReason = '';
      // Record who actually did it now, so approving it later can't rewrite the credit
      // to the person who merely forwarded it.
      parent.completedBy = doer;
      await parent.save();
      await notify({
        user: parent.assignedBy,
        type: 'TASK_APPROVAL',
        title: 'Forwarded work is ready for your approval',
        message: parent.title,
        link: todoLink(parent._id, true),
        entityType: 'Task',
        entityId: parent._id,
      });
    }
    return;
  }

  parent.status = 'DONE';
  parent.completedAt = new Date();
  parent.completedBy = doer; // credit stays with whoever actually did the work
  await parent.save();
  try { await onAssignedTaskDone(parent); } catch (e) { console.error('bonus hook (forward settle) failed', e?.message); }
  if (parent.assignedBy) {
    await notify({
      user: parent.assignedBy,
      type: 'TASK_DONE',
      title: 'A task you assigned is done',
      message: parent.title,
      link: todoLink(parent._id, true),
    });
  }
  await settleParent(parent, depth + 1);
}

/**
 * Every task forwarded down from these — children, grandchildren, and so on. Used to
 * carry an assigner's edit or delete all the way down the hand-off chain, so a junior
 * and a super-junior never end up holding a version the sir has since changed or
 * removed. Depth-guarded against a malformed loop.
 */
async function collectForwardDescendants(rootIds) {
  const out = [];
  const seen = new Set(rootIds.map(String));
  let frontier = rootIds.map(String);
  let depth = 0;
  while (frontier.length && depth < 12) {
    const kids = await Task.find({ forwardedFrom: { $in: frontier } });
    const fresh = kids.filter((k) => !seen.has(String(k._id)));
    if (!fresh.length) break;
    for (const k of fresh) seen.add(String(k._id));
    out.push(...fresh);
    frontier = fresh.map((k) => String(k._id));
    depth += 1;
  }
  return out;
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

  const contentFields = ['title', 'notes', 'dueYMD'];
  const patch = {};
  for (const f of contentFields) if (data[f] !== undefined) patch[f] = data[f];

  // ── Assigner editing a delegated task: may re-assign it, toggle approval, and edit
  //    the content of one copy or every copy of a multi-assign batch. ──────────────
  if (isAssigner) {
    const batchQuery = task.assignBatch ? { assignBatch: task.assignBatch, assignedBy: actor._id } : { _id: task._id };
    let members = await Task.find(batchQuery);

    // Resolved up front because a reassignment creates fresh copies below, and those need
    // the tag list too — they used to be created with `collaborators: []`, quietly
    // dropping everyone who was tagged the moment the work was reassigned.
    const nextCollabs = data.collaborators !== undefined
      ? await resolveCollaborators(actor, data.collaborators, task.collaborators || [])
      : null;

    // (a) Reassignment — make the set of people match `assignTo` (add / remove copies).
    if (data.assignTo !== undefined) {
      const desired = [...new Set((Array.isArray(data.assignTo) ? data.assignTo : [data.assignTo]).map(String))].filter((x) => x && x !== String(actor._id));
      if (!desired.length) throw httpError(400, 'INVALID', 'Pick at least one person to assign this to');
      // Only the NEWLY-added people need to be active & assignable — people already on
      // the batch stay put even if they've since been deactivated (so an inactive member
      // can never dead-end editing the rest of the batch).
      const currentIds = new Set(members.map((mm) => String(mm.owner)));
      const addedIds = desired.filter((id) => !currentIds.has(id));
      let addedUsers = [];
      if (addedIds.length) {
        addedUsers = await User.find({ _id: { $in: addedIds }, isActive: true });
        if (addedUsers.length !== addedIds.length) throw httpError(404, 'NOT_FOUND', 'One of the selected people was not found');
        for (const t of addedUsers) if (!canAssignTo(actor, t)) throw httpError(403, 'FORBIDDEN', 'You can only assign to people you’re allowed to assign work to');
      }

      // Always identify this assignment's copies by a batch id (even a single one), so
      // reconciliation stays reliable after copies are added or removed.
      const batch = task.assignBatch || randomUUID();
      for (const mm of members) {
        if (desired.includes(String(mm.owner))) {
          if (mm.assignBatch !== batch) { mm.assignBatch = batch; await mm.save(); } // retained → keep, stamp
        } else if (mm.status === 'DONE' || mm.awaitingApproval) {
          // Preserve completed / submitted work rather than destroying history & bonus.
          if (mm.assignBatch !== batch) { mm.assignBatch = batch; await mm.save(); }
        } else {
          // Take their forward chain with them, exactly as deleting the task does.
          // Without this, someone they had passed the work down to kept a copy pointing
          // at a parent that no longer existed: finishing it settled nothing, so the
          // assigner never saw it and that person was stuck holding orphaned work.
          // Collected BEFORE the delete, while the links are still intact.
          // Finished or submitted work down the chain is somebody else's record, and it
          // is kept for exactly the reason the branch above keeps the member's own
          // completed copy: deleting it would erase their history and take back the
          // points they earned, for a removal two hand-offs away from them.
          const orphans = (await collectForwardDescendants([mm._id])).filter(
            (d) => d.status !== 'DONE' && !d.awaitingApproval,
          );
          await mm.deleteOne(); // drop a not-yet-started copy for someone taken off the task
          try { await onAssignedTaskUndone(mm._id); } catch (e) { console.error('bonus hook (reassign remove) failed', e?.message); }
          await notify({ user: mm.owner, type: 'TASK_ASSIGNED', title: `${actor.name} removed a task`, message: mm.title, link: '/todo' });
          for (const d of orphans) {
            const ownerId = d.owner;
            const title = d.title;
            const wasOpen = d.status !== 'DONE';
            await d.deleteOne();
            try { await onAssignedTaskUndone(d._id); } catch (e) { console.error('bonus hook (reassign cascade) failed', e?.message); }
            if (wasOpen && String(ownerId) !== String(actor._id)) {
              await notify({ user: ownerId, type: 'TASK_ASSIGNED', title: `${actor.name} removed a task`, message: title, link: '/todo' });
            }
          }
        }
      }
      const base = {
        title: patch.title ?? task.title,
        notes: patch.notes ?? task.notes,
        dueYMD: patch.dueYMD ?? task.dueYMD,
        requiresApproval: data.requiresApproval !== undefined ? !!data.requiresApproval : task.requiresApproval,
      };
      const baseCollabs = (nextCollabs ?? task.collaborators ?? []).filter((cid) => !desired.includes(String(cid)));
      for (const t of addedUsers) {
        const nt = await Task.create({ ...base, owner: t._id, assignedBy: actor._id, collaborators: baseCollabs, assignBatch: batch, status: 'PENDING' });
        await notify({ user: t._id, type: 'TASK_ASSIGNED', title: `New task from ${actor.name}`, message: base.dueYMD ? `${base.title} (due ${base.dueYMD})` : base.title, link: todoLink(nt._id) });
      }
      members = await Task.find({ assignBatch: batch, assignedBy: actor._id });
    }

    // (a2) Tagged people. Tags describe the piece of WORK, not one person's copy —
    //      createTask puts the same list on every copy so a tagged colleague sees the job
    //      whoever it was handed to. Editing follows that rule: the tag list applies to
    //      the whole batch even when a content edit is scoped to a single copy.
    if (nextCollabs) {
      const ownerIds = new Set(members.map((mm) => String(mm.owner)));
      const finalTags = nextCollabs.filter((cid) => !ownerIds.has(String(cid))); // an assignee isn't also a bystander
      const before = new Set((task.collaborators || []).map(String));
      const key = (list) => [...new Set(list.map(String))].sort().join(',');
      for (const mm of members) {
        if (key(mm.collaborators || []) !== key(finalTags)) {
          mm.collaborators = finalTags;
          await mm.save();
        }
      }
      // Once per newly tagged person, not once per copy of the task.
      for (const cid of finalTags) {
        if (before.has(String(cid))) continue;
        await notify({
          user: cid,
          type: 'TASK_ASSIGNED',
          title: `${actor.name} tagged you on a task`,
          message: task.dueYMD ? `${task.title} (due ${task.dueYMD})` : task.title,
          link: taggedLink(members[0]?._id),
        });
      }
    }

    // (b) Content + approval edits — to every copy when scoped to all (applyToAll or a
    //     reassignment just happened), otherwise only the copy that was opened.
    const applyAll = !!data.applyToAll || data.assignTo !== undefined;
    const editSet = applyAll ? members : members.filter((mm) => String(mm._id) === String(id));
    let changedCount = 0;
    const cascadeRoots = []; // copies whose CONTENT changed → push the same content down their forward chains
    for (const mm of editSet) {
      let changed = false;
      let contentChanged = false;
      let dueChanged = false;
      for (const f of contentFields) if (patch[f] !== undefined && mm[f] !== patch[f]) { if (f === 'dueYMD') dueChanged = true; mm[f] = patch[f]; changed = true; contentChanged = true; }
      // Rewriting the work makes an old receipt a lie — "Seen 20 Jul" would refer to
      // wording nobody has read. Clear it so it goes back to "delivered" and earns a
      // fresh receipt the next time the assignee's list loads.
      if (contentChanged && mm.assignedBy && mm.seenAt) mm.seenAt = null;
      if (contentChanged) cascadeRoots.push(mm._id);
      if (data.requiresApproval !== undefined && mm.requiresApproval !== !!data.requiresApproval) {
        mm.requiresApproval = !!data.requiresApproval;
        // Turning the gate OFF: drop any pending submission trail so no orphaned
        // submittedAt survives to mis-score bonus or hide the task from the overdue scan.
        if (!mm.requiresApproval) { mm.submittedAt = null; mm.approvedBy = null; }
        changed = true;
      }
      if (changed) {
        await mm.save();
        changedCount += 1;
        // Moving the due date must re-price the bonus for THIS copy. A finished task is
        // re-scored against its new deadline (a due date pushed past the completion day
        // turns a late −score into an on-time +score, and vice-versa); an unfinished one
        // has any now-stale overdue penalty cleared, and the daily scan re-adds it only if
        // it's still overdue. Without this, correcting a wrong due date left the old
        // points frozen.
        if (dueChanged && mm.assignedBy) {
          try {
            if (mm.status === 'DONE') {
              await onAssignedTaskDone(mm);
              // The result is re-priced above; the per-day overdue charges have to follow
              // the new deadline too, or a finished task keeps days it was never late for.
              await rebuildOverdueForTask(mm._id);
            } else await onAssignedTaskUndone(mm._id);
          } catch (e) { console.error('bonus hook (due-date edit) failed', e?.message); }
        }
        if (mm.status !== 'DONE' && String(mm.owner) !== String(actor._id)) {
          await notify({ user: mm.owner, type: 'TASK_ASSIGNED', title: `${actor.name} updated a task`, message: mm.dueYMD ? `${mm.title} (due ${mm.dueYMD})` : mm.title, link: todoLink(mm._id) });
        }
      }
    }

    // Carry the content edit down every forward chain hanging off an edited copy. Only
    // CONTENT travels — never status, approval or who it's assigned to; those belong to
    // each person's own copy. A DONE copy still gets the corrected wording, but keeps
    // its completion.
    if (cascadeRoots.length && Object.keys(patch).length) {
      const descendants = await collectForwardDescendants(cascadeRoots);
      for (const d of descendants) {
        let dChanged = false;
        let dueChanged = false;
        for (const f of contentFields) if (patch[f] !== undefined && d[f] !== patch[f]) { if (f === 'dueYMD') dueChanged = true; d[f] = patch[f]; dChanged = true; }
        if (dChanged) {
          if (d.seenAt) d.seenAt = null; // rewritten under them → earn a fresh receipt
          await d.save();
          changedCount += 1;
          // Same re-pricing as above, for a copy further down the forward chain.
          if (dueChanged && d.assignedBy) {
            try {
              if (d.status === 'DONE') await onAssignedTaskDone(d);
              else await onAssignedTaskUndone(d._id);
            } catch (e) { console.error('bonus hook (due-date cascade) failed', e?.message); }
          }
          if (d.status !== 'DONE') {
            await notify({ user: d.owner, type: 'TASK_ASSIGNED', title: `${actor.name} updated a task`, message: d.dueYMD ? `${d.title} (due ${d.dueYMD})` : d.title, link: todoLink(d._id) });
          }
        }
      }
    }

    const rep = (await Task.findById(id)) || members[0];
    const out = rep ? await populated(rep) : {};
    return { ...out, batchCount: members.length, changedCount };
  }

  // ── Owner editing their own (personal) task ──────────────────────────────────────
  for (const f of contentFields) if (patch[f] !== undefined) task[f] = patch[f];
  if (data.collaborators !== undefined && isOwner && !task.assignedBy) {
    const before = new Set((task.collaborators || []).map(String));
    const resolved = await resolveCollaborators(actor, data.collaborators, task.collaborators || []);
    task.collaborators = resolved;
    for (const cid of resolved) {
      if (!before.has(String(cid))) {
        await notify({ user: cid, type: 'TASK_ASSIGNED', title: `${actor.name} tagged you on a task`, message: task.dueYMD ? `${task.title} (due ${task.dueYMD})` : task.title, link: taggedLink(task._id) });
      }
    }
  }
  await task.save();
  return populated(task);
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

  // Take the whole forward chain with it: if the sir removes a task, the junior and the
  // super-junior it was passed to shouldn't be left holding a copy of work that no
  // longer exists. Collected BEFORE the delete so the links are still intact.
  const descendants = await collectForwardDescendants([task._id]);

  await task.deleteOne();
  try { await onAssignedTaskUndone(task._id); } catch (e) { console.error('bonus hook (delete) failed', e?.message); }

  for (const d of descendants) {
    const ownerId = d.owner;
    const title = d.title;
    const wasOpen = d.status !== 'DONE';
    await d.deleteOne();
    try { await onAssignedTaskUndone(d._id); } catch (e) { console.error('bonus hook (cascade delete) failed', e?.message); }
    if (wasOpen && String(ownerId) !== String(actor._id)) {
      await notify({ user: ownerId, type: 'TASK_ASSIGNED', title: `${actor.name} removed a task`, message: title, link: '/todo' });
    }
  }

  return { success: true, cascaded: descendants.length };
}

/**
 * "Last N days" counted in WHOLE COMPANY DAYS — today plus the N-1 before it, from
 * midnight IST. A rolling `Date.now() - N*86400000` window cut the earliest day in
 * half, so a task added on the 7th-day morning fell outside "Last 7 days" while one
 * added that afternoon stayed in. The custom from/to branch below already works in
 * whole days; this keeps both readings of the same control identical.
 */
function periodMatch(period, field = 'createdAt') {
  const days = period === 'week' ? 7 : period === 'month' ? 30 : period === 'year' ? 365 : 0;
  if (!days) return {};
  const start = new Date(companyDayFromYMD(ymdInTz(new Date())).getTime() - (days - 1) * 86400000);
  return { [field]: { $gte: start } };
}

/** Shift a YYYY-MM-DD by whole days, staying in the company day grid. */
function shiftYMD(ymd, days) {
  return new Date(companyDayFromYMD(ymd).getTime() + days * 86400000).toISOString().slice(0, 10);
}

/**
 * A window on the DEADLINE, for the two tabs that are about work still to be done.
 *
 * `dueYMD` is a plain YYYY-MM-DD, so a lexical range is exact and index-friendly. Every
 * branch carries `$gt: ''` because an unset deadline is stored as the empty string, and
 * '' compares BELOW every real date — so a plain `$lt: today` would quietly pull in every
 * task that has no deadline at all.
 */
function dueMatch(period, status) {
  const today = ymdInTz(new Date());
  if (period === 'overdue') {
    // Only work that is still OPEN can be late. A finished task with a deadline in the
    // past was delivered — listing it under "Overdue" buried the three things actually
    // outstanding under sixteen that were already done.
    return { dueYMD: { $gt: '', $lt: today }, ...(status ? {} : { status: 'PENDING' }) };
  }
  const days = period === 'next7' ? 7 : period === 'next30' ? 30 : 0;
  if (!days) return {};
  return { dueYMD: { $gt: '', $gte: today, $lte: shiftYMD(today, days - 1) } };
}

export async function listTasks(actor, { scope = 'mine', status, search, period, from, to, dateBasis, awaiting, page = 1, limit = 200 }) {
  const and = [];
  // Three distinct kinds of work, never mixed:
  //   assigned — work I handed to someone else,
  //   tagged   — somebody else's task I was only tagged on (kept in the loop): it is
  //              NOT mine to do and must never count towards my task figures,
  //   mine     — what I actually own: my own to-dos plus work delegated TO me.
  // "mine" used to include tagged rows, which is what made a colleague's task show up
  // as the viewer's own and inflate every count built on this list.
  if (scope === 'assigned') and.push({ assignedBy: actor._id });
  else if (scope === 'tagged') {
    // Owner-guard matters: without it a legacy row where somebody is in their own
    // collaborators list would appear as "tagged on their own task".
    and.push({ collaborators: actor._id, owner: { $ne: actor._id } });
  } else {
    and.push({ owner: actor._id });
    // Work I have PASSED ON is no longer mine to do, so it leaves my own list. It shows
    // up under "Assigned by me" instead — as the copy I handed over, which is the one
    // carrying the live status — and that copy's hand-off trail says the work came from
    // above me and where I sent it. Keeping the old copy here too made one job appear
    // as both my task and my delegated work.
    //
    // The children I created by forwarding are exactly the tasks whose assigner is me,
    // so their `forwardedFrom` values are precisely my own passed-on copies.
    const passedOn = await Task.distinct('forwardedFrom', { assignedBy: actor._id, forwardedFrom: { $ne: null } });
    if (passedOn.length) and.push({ _id: { $nin: passedOn } });
  }
  if (status && ['PENDING', 'DONE'].includes(status)) and.push({ status });
  // WHICH date a range means. The caller says so explicitly, because the answer differs
  // per tab and guessing it was the bug: a list whose every visible date is a DEADLINE
  // was being filtered on when each row happened to be created, so picking "27–30 July"
  // dropped work that was plainly due on the 27th. Older callers that say nothing keep
  // the previous behaviour — completed work by completion, open work by creation.
  const basis = ['due', 'added', 'completed'].includes(dateBasis)
    ? dateBasis
    : (status === 'DONE' ? 'completed' : 'added');
  const onDue = basis === 'due';
  const dateField = basis === 'completed' ? 'completedAt' : 'createdAt';
  // Kept so the caller can say how many rows a deadline window pushed out of sight.
  let noDueHidden = 0;
  let dateClauseApplied = false;
  const andBeforeDate = [...and];

  // The approval queue is work sitting and waiting on the actor — it is never "out of
  // range". A date filter that hid a submission from three weeks ago would leave the
  // assignee blocked with no way for the assigner to notice, so this scope ignores it.
  if (awaiting) {
    and.push({ requiresApproval: true, status: 'PENDING', submittedAt: { $ne: null } });
  } else if (from || to) {
    // A custom date range (x → y) takes precedence over the preset period.
    dateClauseApplied = true;
    if (onDue) {
      const r = { $gt: '' }; // never let an unset deadline slip in through a one-sided range
      if (from) r.$gte = from;
      if (to) r.$lte = to;
      and.push({ dueYMD: r });
    } else {
      const r = {};
      if (from) r.$gte = companyDayFromYMD(from);
      if (to) r.$lt = new Date(companyDayFromYMD(to).getTime() + 86400000); // through end of `to` day
      and.push({ [dateField]: r });
    }
  } else {
    const pm = onDue ? dueMatch(period, status) : periodMatch(period, dateField);
    if (Object.keys(pm).length) {
      and.push(pm);
      dateClauseApplied = true;
      // "Overdue" also narrows to open work; the undated count below has to narrow the
      // same way, or it would offer to show finished work as "hidden".
      const { dueYMD: _dueRange, ...rest } = pm;
      if (Object.keys(rest).length) andBeforeDate.push(rest);
    }
  }
  // A deadline window is in force only if the date clause actually narrowed anything.
  const dueWindowOn = onDue && !awaiting && dateClauseApplied;

  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    // Match the PEOPLE too, not just the words. My tasks and Assigned search the loaded
    // list client-side and there a name counts as a hit ("show me everything Priyanshi
    // gave me"); History and the PDF go through here, so typing a name had to mean the
    // same thing in all three places or the same query gave different answers per tab.
    const people = await User.find({ name: rx }).select('_id').lean();
    const ids = people.map((p) => p._id);
    const or = [{ title: rx }, { notes: rx }];
    if (ids.length) or.push({ owner: { $in: ids } }, { assignedBy: { $in: ids } }, { collaborators: { $in: ids } });
    and.push({ $or: or });
    andBeforeDate.push({ $or: or });
  }
  const filter = and.length === 1 ? and[0] : { $and: and };

  // Work with no deadline at all can't sit inside a deadline window, so it drops out.
  // Count it, so the page can say "2 with no due date hidden" instead of letting a task
  // disappear with no explanation — which is how a filter earns a reputation for eating
  // things.
  if (dueWindowOn) {
    const noDueFilter = { $and: [...andBeforeDate, { $or: [{ dueYMD: '' }, { dueYMD: null }, { dueYMD: { $exists: false } }] }] };
    noDueHidden = await Task.countDocuments(noDueFilter);
  }

  const skip = (page - 1) * limit;
  const [tasks, total] = await Promise.all([
    // Order by whatever the date filter narrowed on. History filtered on `completedAt`
    // but listed by `createdAt`, so picking a range reshuffled nothing visible and the
    // filter read as dead. A deadline window sorts soonest-first; `submittedAt` first for
    // the approval queue, so the longest wait is on top.
    Task.find(filter).sort(awaiting ? { submittedAt: 1 } : onDue ? { dueYMD: 1 } : { [dateField]: -1 }).skip(skip).limit(limit).populate('owner', 'name').populate('assignedBy', 'name').populate('collaborators', 'name').populate('completedBy', 'name').populate('approvedBy', 'name').populate('originalAssignedBy', 'name'),
    Task.countDocuments(filter),
  ]);

  const out = tasks.map((t) => t.toJSON());

  // Attach teammates' progress on multi-assign batches, so each person can see who else
  // is on the task and whether they've done it (per-person completion).
  const batchIds = [...new Set(out.map((t) => t.assignBatch).filter(Boolean))];
  if (batchIds.length) {
    const sibs = await Task.find({ assignBatch: { $in: batchIds } }).select('assignBatch owner status submittedAt requiresApproval').populate('owner', 'name');
    const byBatch = new Map();
    for (const s of sibs) {
      const arr = byBatch.get(s.assignBatch) || [];
      arr.push({
        id: s.id,
        owner: s.owner ? { id: s.owner.id, name: s.owner.name } : null,
        status: s.status,
        awaitingApproval: s.awaitingApproval,
      });
      byBatch.set(s.assignBatch, arr);
    }
    for (const t of out) {
      if (t.assignBatch && byBatch.has(t.assignBatch)) {
        t.siblings = byBatch.get(t.assignBatch).filter((s) => s.id !== t.id);
      }
    }
  }

  // Who a task was passed on to, so a forwarded copy shows where the work now sits
  // rather than looking like it's been sitting untouched.
  const parentIds = out.filter((t) => !t.forwardedFrom).map((t) => t.id);
  if (parentIds.length) {
    const kids = await Task.find({ forwardedFrom: { $in: parentIds } })
      .select('forwardedFrom owner status submittedAt requiresApproval')
      .populate('owner', 'name');
    if (kids.length) {
      const byParent = new Map();
      for (const k of kids) {
        const key = String(k.forwardedFrom);
        const arr = byParent.get(key) || [];
        arr.push({ id: k.id, owner: k.owner ? { id: k.owner.id, name: k.owner.name } : null, status: k.status, awaitingApproval: k.awaitingApproval });
        byParent.set(key, arr);
      }
      for (const t of out) {
        const kidsOf = byParent.get(String(t.id));
        if (kidsOf) t.forwardedTo = kidsOf;
      }
    }
  }

  // The full hand-off chain for a forwarded task: who started it, everyone it passed
  // through, and where it sits now — e.g. Khaan Aamir → Priyanshi Patel → You. The row
  // only stores its immediate parent (forwardedFrom) and the root originator
  // (originalAssignedBy), so the middle links are rebuilt by walking up the parents.
  const forwardedRows = out.filter((t) => t.forwardedFrom);
  if (forwardedRows.length) {
    const nodeCache = new Map(); // taskId → { ownerId, ownerName, assignerId, assignerName, forwardedFrom }
    const loadNode = async (tid) => {
      const key = String(tid);
      if (nodeCache.has(key)) return nodeCache.get(key);
      const doc = await Task.findById(tid).select('owner assignedBy forwardedFrom').populate('owner', 'name').populate('assignedBy', 'name');
      const n = doc
        ? {
            ownerId: doc.owner ? String(doc.owner._id) : null,
            ownerName: doc.owner?.name || null,
            assignerId: doc.assignedBy ? String(doc.assignedBy._id) : null,
            assignerName: doc.assignedBy?.name || null,
            forwardedFrom: doc.forwardedFrom || null,
          }
        : null;
      nodeCache.set(key, n);
      return n;
    };

    for (const t of forwardedRows) {
      // The originator is authoritative on the row itself (originalAssignedBy is stamped
      // at forward time), so it's correct no matter how deep the chain — never derived
      // from the walk, which is only used to collect the OWNERS in between.
      const originator = { id: t.originalAssignedBy?.id ? String(t.originalAssignedBy.id) : null, name: t.originalAssignedBy?.name || null };
      const handlers = [{ id: t.owner?.id ? String(t.owner.id) : null, name: t.owner?.name || null }];
      let parentId = t.forwardedFrom;
      let depth = 0;
      while (parentId && depth < 12) {
        const parent = await loadNode(parentId); // eslint-disable-line no-await-in-loop
        if (!parent) break;
        handlers.unshift({ id: parent.ownerId, name: parent.ownerName });
        parentId = parent.forwardedFrom;
        depth += 1;
      }
      const chain = [originator, ...handlers].filter((n) => n.name);
      // Only worth showing once it's genuinely a chain (originator + ≥2 handlers).
      if (chain.length >= 3) t.forwardChain = chain;
    }
  }

  // The bonus grace days ride along so the UI can say exactly when a task stops counting
  // as on-time (the same number scanOverdueTasks and the completion scoring use). It is a
  // single cached settings read, and it is 0 unless leadership sets one.
  const gSettings = await Setting.getSingleton();
  const graceDays = Math.max(0, gSettings.bonus?.graceDays ?? 0);

  return { tasks: out, total, page, limit, noDueHidden, graceDays };
}

export async function taskSummary(actor) {
  // The same exclusion listTasks applies: work I passed on isn't counted as mine, or the
  // badge would promise more rows than the list shows.
  const passedOn = await Task.distinct('forwardedFrom', { assignedBy: actor._id, forwardedFrom: { $ne: null } });
  const [mine, assigned, tagged] = await Promise.all([
    // Mine = what I OWN (my own to-dos + work delegated to me). Tagged rows are somebody
    // else's work and are counted separately below, never here — these are the figures
    // the stat boxes and the header badge show.
    Task.aggregate([
      { $match: { owner: actor._id, ...(passedOn.length ? { _id: { $nin: passedOn } } : {}) } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    Task.aggregate([{ $match: { assignedBy: actor._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Task.aggregate([
      { $match: { collaborators: actor._id, owner: { $ne: actor._id } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
  ]);
  const pick = (agg, st) => agg.find((a) => a._id === st)?.n ?? 0;
  const box = (agg) => ({ pending: pick(agg, 'PENDING'), done: pick(agg, 'DONE'), total: pick(agg, 'PENDING') + pick(agg, 'DONE') });
  return { mine: box(mine), assigned: box(assigned), tagged: box(tagged) };
}
