import { Task } from '../models/Task.js';

/**
 * WHO MAY SIGN A SUBMITTED TASK OFF — the one place that answers it.
 *
 * The answer is needed in four different shapes: the guard that accepts a review, the
 * bell that tells people there is something to review, the flag the To-Do page hangs its
 * Approve button on, and the Approvals inbox that lists the queue. When those drift
 * apart people get a button that refuses them, or a badge that never clears, or they are
 * never told they can act — so all four read from here instead of restating the rule.
 *
 * The rule (owner's, 8 Sep 2026): the person who handed the work out, plus anyone TAGGED
 * on it — minus whoever actually did it. Nobody signs off their own delivery.
 */

/** Ids arrive as ObjectIds, as populated docs, or as toJSON's `{ id, name }`. */
const idOf = (v) => (v == null ? '' : String(v._id ?? v.id ?? v));

/**
 * For each of these tasks, everyone holding a copy BELOW it in a forward chain.
 *
 * That set is the "did the work" test the copy itself cannot answer: an assignee can
 * forward the work to the very colleague who was tagged to approve it, and settling the
 * chain stamps only the LAST doer as completedBy — so a tagged person sitting in the
 * middle of a three-deep chain looks innocent on the document and is anything but.
 *
 * One breadth-first sweep for every root at once, so listing a page of tasks costs a
 * handful of queries rather than one per row. Depth-capped like the rest of the forward
 * code, so a cycle in the data can never spin here.
 */
export async function chainOwnersByRoot(rootIds) {
  const out = new Map();
  const roots = [...new Set((rootIds || []).map(idOf).filter(Boolean))];
  if (!roots.length) return out;
  for (const r of roots) out.set(r, new Set());

  // Every id currently at the frontier, mapped back to the root it descends from.
  let frontier = new Map(roots.map((r) => [r, r]));
  for (let depth = 0; frontier.size && depth < 12; depth += 1) {
    // eslint-disable-next-line no-await-in-loop
    const kids = await Task.find({ forwardedFrom: { $in: [...frontier.keys()] } })
      .select('owner forwardedFrom').lean();
    if (!kids.length) break;
    const next = new Map();
    for (const k of kids) {
      const root = frontier.get(String(k.forwardedFrom));
      if (!root) continue;
      out.get(root).add(String(k.owner));
      next.set(String(k._id), root);
    }
    frontier = next;
  }
  return out;
}

/** The same sweep for a single task. */
export async function chainOwnersOf(taskId) {
  return (await chainOwnersByRoot([taskId])).get(idOf(taskId)) || new Set();
}

/**
 * Everyone who may review this task. `chainOwners` is the set from chainOwnersByRoot —
 * pass it in so callers that already ran the sweep for a whole page don't run it again.
 */
export function approverIdsFor(task, chainOwners = new Set()) {
  // Deleting an assigner's account nulls assignedBy but leaves the submission standing.
  // Such a task has nobody to answer for it, and stays un-reviewable rather than becoming
  // closable by a bystander — exactly as it behaved before tagged sign-off existed.
  if (!task?.assignedBy) return [];
  const doers = new Set([idOf(task.owner), ...chainOwners]);
  if (task.completedBy) doers.add(idOf(task.completedBy));

  const out = [];
  const assigner = idOf(task.assignedBy);
  if (!doers.has(assigner)) out.push(assigner);
  for (const c of task.collaborators || []) {
    const id = idOf(c);
    if (id && !doers.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** May this person review this task right now? */
export function canReviewTask(task, userId, chainOwners = new Set()) {
  // `awaitingApproval` is a virtual, so it is simply absent on a .lean() row — recompute
  // it from the same three fields rather than reading a silent `undefined` as "no".
  const awaiting = task?.awaitingApproval
    ?? (!!task?.requiresApproval && task?.status === 'PENDING' && !!task?.submittedAt);
  if (!awaiting) return false;
  return approverIdsFor(task, chainOwners).includes(idOf(userId));
}

/**
 * The database half of the rule, for queries that must narrow before they fetch.
 *
 * Deliberately WIDER than the real answer: a chain of hand-offs cannot be expressed as
 * one Mongo filter, so this catches the cheap exclusions and callers then sieve the rows
 * through canReviewTask. Never use it on its own to decide whether to show an action.
 */
export const reviewableByFilter = (uid) => ({
  requiresApproval: true,
  submittedAt: { $ne: null },
  $or: [
    { assignedBy: uid },
    { assignedBy: { $ne: null }, collaborators: uid, owner: { $ne: uid }, completedBy: { $ne: uid } },
  ],
});

/** Rows from `reviewableByFilter`, sieved through the real rule. */
export async function sieveReviewable(rows, uid) {
  if (!rows.length) return rows;
  const chains = await chainOwnersByRoot(rows.map((r) => r._id));
  return rows.filter((r) => canReviewTask(r, uid, chains.get(String(r._id)) || new Set()));
}
