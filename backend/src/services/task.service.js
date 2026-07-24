import { randomUUID } from 'node:crypto';
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

/** Everyone in the office, for tagging — anyone can be a colleague on a task. */
export async function taggableUsers(actor) {
  const users = await User.find({ isActive: true, _id: { $ne: actor._id } }).select('name designation role').sort({ name: 1 });
  return users.map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', role: u.role, roleLabel: roleLabel(u.role) }));
}

/**
 * Validate & normalise a list of colleague ids the actor wants to tag on their own
 * task. Deliberately NOT the delegation ACL: tagging says "this person is working on
 * this with me", which is a fact about who is involved, not an instruction — so anyone
 * in the office can be tagged, while handing work TO someone still needs assign access.
 * Drops self, dedupes, and rejects the whole set if an id isn't a real active person.
 */
async function resolveCollaborators(actor, ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const uniq = [...new Set(ids.map(String))].filter((id) => id !== String(actor._id));
  if (!uniq.length) return [];
  const users = await User.find({ _id: { $in: uniq }, isActive: true });
  if (users.length !== uniq.length) {
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

    const created = [];
    for (const target of targets) {
      const task = await Task.create({
        title: data.title,
        notes: data.notes || '',
        dueYMD: data.dueYMD || '',
        owner: target._id,
        assignedBy: actor._id,
        collaborators: [],
        assignBatch: batch,
        requiresApproval: !!data.requiresApproval,
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

async function populated(task) {
  await task.populate('owner', 'name');
  await task.populate('assignedBy', 'name');
  await task.populate('collaborators', 'name');
  await task.populate('completedBy', 'name');
  await task.populate('approvedBy', 'name');
  await task.populate('originalAssignedBy', 'name');
  return task.toJSON();
}

export async function setStatus(actor, id, status) {
  const task = await Task.findById(id);
  if (!task) throw httpError(404, 'NOT_FOUND', 'Task not found');
  const isOwner = String(task.owner) === String(actor._id);
  const isCollaborator = (task.collaborators || []).some((c) => String(c) === String(actor._id));
  const isAssigner = task.assignedBy && String(task.assignedBy) === String(actor._id);
  // The owner (or a tagged collaborator) marks their OWN copy. Each multi-assign copy
  // is independent now — completing one does NOT complete the others.
  if (!isOwner && !isCollaborator) throw httpError(403, 'FORBIDDEN', 'Only the task owner or a tagged teammate can update it');

  const wantDone = status === 'DONE';

  // Approval gate: when the assigner required approval, the assignee marking "done"
  // SUBMITS for review instead of closing it. It sits as "awaiting approval" until the
  // assigner approves/rejects (reviewTask). The submit time is the on-time reference so
  // a slow approval never turns on-time work into "late".
  if (wantDone && task.requiresApproval && task.assignedBy && isOwner && task.status !== 'DONE') {
    task.submittedAt = new Date();
    task.rejectionReason = '';
    await task.save();
    await notify({
      user: task.assignedBy,
      type: 'TASK_ASSIGNED',
      title: `${actor.name} submitted work for approval`,
      message: task.title,
      link: '/todo?tab=assigned',
    });
    return populated(task);
  }

  // Withdraw a pending submission (assignee pulls it back before it's reviewed).
  if (!wantDone && task.awaitingApproval) {
    task.submittedAt = null;
    await task.save();
    return populated(task);
  }

  task.status = wantDone ? 'DONE' : 'PENDING';
  task.completedAt = wantDone ? new Date() : null;
  task.completedBy = wantDone ? actor._id : null;
  if (!wantDone) { task.submittedAt = null; task.approvedBy = null; } // reopening clears the submission/approval trail

  await task.save();

  if (task.status === 'DONE') {
    if (task.assignedBy && !isAssigner) {
      await notify({ user: task.assignedBy, type: 'TASK_DONE', title: `${actor.name} completed a task`, message: task.title, link: '/todo?tab=assigned' });
    }
    // Legacy shared "collaborator" task (single doc, tagged teammates) → tell the others.
    const involved = new Set([String(task.owner), ...(task.collaborators || []).map(String)]);
    involved.delete(String(actor._id));
    for (const uid of involved) {
      await notify({ user: uid, type: 'TASK_DONE', title: `${actor.name} completed a shared task`, message: task.title, link: '/todo' });
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
 * approve → it's DONE (credited to the assignee, on-time judged from submit time),
 * reject → back to the assignee's to-do with the reason.
 */
export async function reviewTask(actor, id, approve, reason) {
  const task = await Task.findById(id);
  if (!task) throw httpError(404, 'NOT_FOUND', 'Task not found');
  const isAssigner = task.assignedBy && String(task.assignedBy) === String(actor._id);
  if (!isAssigner) throw httpError(403, 'FORBIDDEN', 'Only the person who assigned this task can review it');
  if (!task.awaitingApproval) throw httpError(400, 'NOT_AWAITING', 'This task isn’t waiting for approval');

  if (approve) {
    task.status = 'DONE';
    task.completedAt = new Date();
    // Normally the assignee did it. For forwarded work the real doer was already
    // recorded further down the chain, so never overwrite it.
    task.completedBy = task.completedBy || task.owner;
    task.approvedBy = actor._id;
    task.rejectionReason = '';
    await task.save();
    await notify({ user: task.owner, type: 'TASK_DONE', title: `${actor.name} approved your task`, message: task.title, link: '/todo' });
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
      link: '/todo',
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
  if (!isOwner || !task.assignedBy || task.seenAt) return populated(task);
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

  await notify({
    user: target._id,
    type: 'TASK_ASSIGNED',
    title: `${actor.name} forwarded a task to you`,
    message: parent.dueYMD ? `${parent.title} (due ${parent.dueYMD})` : parent.title,
    link: '/todo',
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
        type: 'TASK_ASSIGNED',
        title: 'Forwarded work is ready for your approval',
        message: parent.title,
        link: '/todo?tab=assigned',
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
      link: '/todo?tab=assigned',
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
          await mm.deleteOne(); // drop a not-yet-started copy for someone taken off the task
          try { await onAssignedTaskUndone(mm._id); } catch (e) { console.error('bonus hook (reassign remove) failed', e?.message); }
          await notify({ user: mm.owner, type: 'TASK_ASSIGNED', title: `${actor.name} removed a task`, message: mm.title, link: '/todo' });
        }
      }
      const base = {
        title: patch.title ?? task.title,
        notes: patch.notes ?? task.notes,
        dueYMD: patch.dueYMD ?? task.dueYMD,
        requiresApproval: data.requiresApproval !== undefined ? !!data.requiresApproval : task.requiresApproval,
      };
      for (const t of addedUsers) {
        await Task.create({ ...base, owner: t._id, assignedBy: actor._id, collaborators: [], assignBatch: batch, status: 'PENDING' });
        await notify({ user: t._id, type: 'TASK_ASSIGNED', title: `New task from ${actor.name}`, message: base.dueYMD ? `${base.title} (due ${base.dueYMD})` : base.title, link: '/todo' });
      }
      members = await Task.find({ assignBatch: batch, assignedBy: actor._id });
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
      for (const f of contentFields) if (patch[f] !== undefined && mm[f] !== patch[f]) { mm[f] = patch[f]; changed = true; contentChanged = true; }
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
        if (mm.status !== 'DONE' && String(mm.owner) !== String(actor._id)) {
          await notify({ user: mm.owner, type: 'TASK_ASSIGNED', title: `${actor.name} updated a task`, message: mm.dueYMD ? `${mm.title} (due ${mm.dueYMD})` : mm.title, link: '/todo' });
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
        for (const f of contentFields) if (patch[f] !== undefined && d[f] !== patch[f]) { d[f] = patch[f]; dChanged = true; }
        if (dChanged) {
          if (d.seenAt) d.seenAt = null; // rewritten under them → earn a fresh receipt
          await d.save();
          changedCount += 1;
          if (d.status !== 'DONE') {
            await notify({ user: d.owner, type: 'TASK_ASSIGNED', title: `${actor.name} updated a task`, message: d.dueYMD ? `${d.title} (due ${d.dueYMD})` : d.title, link: '/todo' });
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
    const resolved = await resolveCollaborators(actor, data.collaborators);
    task.collaborators = resolved;
    for (const cid of resolved) {
      if (!before.has(String(cid))) {
        await notify({ user: cid, type: 'TASK_ASSIGNED', title: `${actor.name} tagged you on a task`, message: task.dueYMD ? `${task.title} (due ${task.dueYMD})` : task.title, link: '/todo' });
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
    Task.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('owner', 'name').populate('assignedBy', 'name').populate('collaborators', 'name').populate('completedBy', 'name').populate('approvedBy', 'name').populate('originalAssignedBy', 'name'),
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

  return { tasks: out, total, page, limit };
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
