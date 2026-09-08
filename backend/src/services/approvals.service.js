import { LeaveRequest } from '../models/LeaveRequest.js';
import { Regularization } from '../models/Regularization.js';
import { Task } from '../models/Task.js';
import { can } from '../lib/permissions.js';
import { reviewableByFilter, sieveReviewable } from '../lib/taskApprovers.js';
import { ymdInTz, companyDayFromYMD } from '../lib/time.js';

/**
 * Everything waiting on ONE person's decision, gathered from the three places
 * decisions live: leave requests, attendance corrections and delegated tasks.
 *
 * This service only READS. Every decision still goes through the endpoint that
 * already owned it — /leaves/:id/decision, /regularization/:id/decide,
 * /tasks/:id/review — so the inbox and the original pages can never drift apart or
 * enforce different rules. Approving from here is approving from there.
 *
 * The three sections are scoped differently, and deliberately so:
 *  - leave and corrections are PERMISSIONS, held by whoever leadership granted them to;
 *  - tasks are REACH — a task comes to whoever handed it out and asked to see it
 *    finished, and to anyone TAGGED on it (owner's rule, 8 Sep 2026), which can be
 *    anybody, permission or not. Never to whoever actually did the work.
 * So an employee who delegates one task with approval switched on gets a Tasks
 * section and nothing else, which is exactly right.
 */

const LEAVE_FIELDS = 'user type startYMD endYMD workingDays halfDay reason status appliedAt decidedBy decidedAt decisionNote';
const REG_FIELDS = 'user dateYMD requestedCheckIn requestedCheckOut reason status decidedBy decidedAt decisionNote createdAt';

/**
 * Whether this module belongs to this person at all.
 *
 * It is for people who hold an approval DUTY — leave, attendance corrections, or both.
 * Approving work you handed out is not such a duty: everybody can delegate a task and
 * ask to see it finished, and that already happens on the To-Do page where the work
 * lives. Letting task-ownership alone open this module put an inbox in front of nine
 * people who have nothing to decide in it.
 */
export function canUseApprovals(user) {
  return can(user, 'approveLeave') || can(user, 'approveRegularization');
}

/**
 * Which sections this person can see. Leave and corrections follow the permission; work
 * follows REACH — you see approvals on work you handed out, and on work you were tagged
 * on, so two people with identical permissions still never see each other's untagged work.
 */
export function sectionsFor(user) {
  const allowed = canUseApprovals(user);
  return {
    leaves: can(user, 'approveLeave'),
    regularizations: can(user, 'approveRegularization'),
    // Only inside this module, and only what you can reach — see reviewableBy above.
    tasks: allowed,
  };
}

/** Everything pending this person's decision, plus a count per section. */
export async function pendingFor(user) {
  const sections = sectionsFor(user);

  const [leaves, regularizations, tasks] = await Promise.all([
    sections.leaves
      ? LeaveRequest.find({ status: 'PENDING' })
          .select(LEAVE_FIELDS)
          .sort({ appliedAt: 1 }) // oldest first: the one that has waited longest is the one to act on
          .limit(200)
          .populate('user', 'name employeeId role')
      : [],
    sections.regularizations
      ? Regularization.find({ status: 'PENDING' })
          .select(REG_FIELDS)
          .sort({ createdAt: 1 })
          .limit(200)
          .populate('user', 'name employeeId role')
      : [],
    // Work this person can sign off: what they handed out, plus anything they were
    // TAGGED on (owner's rule, 8 Sep 2026). `submittedAt` set with no decision yet is
    // exactly what the awaitingApproval virtual means; querying the fields directly
    // keeps it a database filter rather than a scan.
    //
    // Reach is what keeps two people with identical permissions from seeing each other's
    // work — three CEOs share every leave in the queue, and share only the tasks they
    // were actually named on.
    sections.tasks
      ? Task.find({ ...reviewableByFilter(user._id), status: { $ne: 'DONE' } })
          .select('title notes dueYMD owner submittedAt completedBy assignBatch')
          .sort({ submittedAt: 1 })
          .limit(200)
          .populate('owner', 'name employeeId')
          .populate('completedBy', 'name')
      : [],
  ]);

  // The query above narrows as far as one Mongo filter can; a chain of hand-offs cannot
  // be expressed there, so the rows are sieved through the real rule. Without this the
  // inbox lists work its own guard would refuse — an Approve button that 403s, and a
  // counter that never clears.
  const reviewableTasks = await sieveReviewable(tasks, user._id);

  const todayYMD = ymdInTz(new Date());
  return {
    sections,
    // The client hides the whole page on this; the empty sections above are what
    // actually enforce it, so a hand-built request gets nothing either way.
    allowed: canUseApprovals(user),
    today: todayYMD,
    leaves: leaves.map((l) => l.toJSON()),
    regularizations: regularizations.map((r) => r.toJSON()),
    tasks: reviewableTasks.map((t) => t.toJSON()),
    counts: {
      leaves: leaves.length,
      regularizations: regularizations.length,
      tasks: reviewableTasks.length,
      total: leaves.length + regularizations.length + reviewableTasks.length,
    },
  };
}

/**
 * What has been decided, over a window they choose — so "which leave was approved last
 * month?" is answerable here instead of on another screen.
 *
 * Scoped to MATCH THE PENDING SIDE, which is the whole point of the page. Pending
 * shows every leave awaiting a decision, not only the ones you happen to be named on,
 * so history shows every leave that was decided — with the decider's name on each row.
 * Filtering history to your own decisions made the two halves disagree: three leaves
 * were approved and the page showed two, because a colleague approved the third.
 *
 * Tasks are the exception and stay within reach. A task approval belongs to whoever
 * handed the work out and to anyone tagged on it; listing everybody's would put other
 * people's work on your screen, which is a different thing from a shared approval queue.
 * A task counts as decided once ANYONE has decided it — scoping that to "I approved it"
 * would erase the assigner's own record whenever a tagged colleague signed it off.
 *
 * `kind` narrows it to one type, because the page shows one type at a time.
 */
export async function historyFor(user, { fromYMD, toYMD, kind } = {}) {
  const sections = sectionsFor(user);

  // A window is required; default to the last 30 days when none is given.
  const to = toYMD || ymdInTz(new Date());
  const from = fromYMD || ymdInTz(new Date(Date.now() - 30 * 86400000));
  const since = companyDayFromYMD(from);
  // toYMD is the START of that day, so a decision made later the same day would fall
  // outside a $lte on it.
  const until = new Date(companyDayFromYMD(to).getTime() + 86400000 - 1);
  const want = (k) => !kind || kind === 'all' || kind === k;

  const [leaves, regularizations, tasks] = await Promise.all([
    sections.leaves && want('leaves')
      ? // APPROVED/REJECTED only. Cancelling reuses decidedBy and decidedAt on this
        // model, so without the status filter a leave somebody withdrew themselves
        // would be listed here as though it had been refused.
        LeaveRequest.find({ decidedAt: { $gte: since, $lte: until }, status: { $in: ['APPROVED', 'REJECTED'] } })
          .select(LEAVE_FIELDS)
          .sort({ decidedAt: -1 })
          .limit(200)
          .populate('user', 'name employeeId')
          .populate('decidedBy', 'name')
      : [],
    sections.regularizations && want('regularizations')
      ? Regularization.find({ decidedAt: { $gte: since, $lte: until }, status: { $ne: 'PENDING' } })
          .select(REG_FIELDS)
          .sort({ decidedAt: -1 })
          .limit(200)
          .populate('user', 'name employeeId')
          .populate('decidedBy', 'name')
      : [],
    // A rejection sends the task back to PENDING and keeps the reason, so both
    // outcomes are found by "I approved it" or "I left a reason".
    sections.tasks && want('tasks')
      ? Task.find({
          requiresApproval: true,
          updatedAt: { $gte: since, $lte: until },
          // Reachable by this person...
          $and: [
            { $or: [{ assignedBy: user._id }, { collaborators: user._id, owner: { $ne: user._id } }] },
            // ...and actually decided — by ANYONE who could. Scoping this to "I approved
            // it" used to be the same thing, because only the assigner ever could; now a
            // tagged colleague can, and that would erase the assigner's own record of
            // work they handed out being signed off.
            { $or: [{ approvedBy: { $ne: null } }, { rejectionReason: { $nin: ['', null] } }] },
          ],
        })
          .select('title owner status approvedBy rejectionReason completedAt updatedAt')
          .sort({ updatedAt: -1 })
          .limit(200)
          .populate('owner', 'name employeeId')
      : [],
  ]);

  return {
    sections,
    allowed: canUseApprovals(user),
    range: { from, to },
    kind: kind || 'all',
    leaves: leaves.map((l) => l.toJSON()),
    regularizations: regularizations.map((r) => r.toJSON()),
    tasks: tasks.map((t) => t.toJSON()),
  };
}

/** Just the number, for the sidebar dot. Cheap: counts only, no documents. */
export async function pendingCount(user) {
  const sections = sectionsFor(user);
  const [leaves, regularizations, tasks] = await Promise.all([
    sections.leaves ? LeaveRequest.countDocuments({ status: 'PENDING' }) : 0,
    sections.regularizations ? Regularization.countDocuments({ status: 'PENDING' }) : 0,
    sections.tasks
      ? Task.find({ ...reviewableByFilter(user._id), status: { $ne: 'DONE' } })
          .select('owner assignedBy collaborators completedBy requiresApproval submittedAt status')
          .limit(500)
      : [],
  ]);
  // Same sieve as pendingFor, so the badge and the list can never disagree.
  const taskCount = sections.tasks ? (await sieveReviewable(tasks, user._id)).length : 0;
  return { leaves, regularizations, tasks: taskCount, total: leaves + regularizations + taskCount };
}
