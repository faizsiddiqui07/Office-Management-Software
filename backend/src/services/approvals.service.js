import { LeaveRequest } from '../models/LeaveRequest.js';
import { Regularization } from '../models/Regularization.js';
import { Task } from '../models/Task.js';
import { can } from '../lib/permissions.js';
import { ymdInTz } from '../lib/time.js';

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
 *  - tasks are OWNERSHIP — a task comes to whoever handed it out and asked to see it
 *    finished, which can be anybody, permission or not.
 * So an employee who delegates one task with approval switched on gets a Tasks
 * section and nothing else, which is exactly right.
 */

const LEAVE_FIELDS = 'user type startYMD endYMD workingDays halfDay reason status appliedAt decidedBy decidedAt decisionNote';
const REG_FIELDS = 'user dateYMD requestedCheckIn requestedCheckOut reason status decidedBy decidedAt decisionNote createdAt';

/** Which sections this person can see at all. Drives both the payload and the UI. */
export function sectionsFor(user) {
  return {
    leaves: can(user, 'approveLeave'),
    regularizations: can(user, 'approveRegularization'),
    tasks: true, // gated by ownership, not permission — always worth checking
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
    // Only tasks THIS person handed out and asked to approve. `submittedAt` set with
    // no decision yet is exactly what the awaitingApproval virtual means; querying the
    // fields directly keeps it a database filter rather than a scan.
    Task.find({ assignedBy: user._id, requiresApproval: true, submittedAt: { $ne: null }, status: { $ne: 'DONE' } })
      .select('title notes dueYMD owner submittedAt completedBy assignBatch')
      .sort({ submittedAt: 1 })
      .limit(200)
      .populate('owner', 'name employeeId')
      .populate('completedBy', 'name'),
  ]);

  const todayYMD = ymdInTz(new Date());
  return {
    sections,
    today: todayYMD,
    leaves: leaves.map((l) => l.toJSON()),
    regularizations: regularizations.map((r) => r.toJSON()),
    tasks: tasks.map((t) => t.toJSON()),
    counts: {
      leaves: leaves.length,
      regularizations: regularizations.length,
      tasks: tasks.length,
      total: leaves.length + regularizations.length + tasks.length,
    },
  };
}

/**
 * What this person decided recently — so the page can answer "did I already deal with
 * that?" without sending them back to three other screens. Their OWN decisions only:
 * this is a record of what you did, not an audit of everyone.
 */
export async function historyFor(user, days = 30) {
  const sections = sectionsFor(user);
  const since = new Date(Date.now() - Math.min(Math.max(days, 1), 180) * 86400000);

  const [leaves, regularizations, tasks] = await Promise.all([
    sections.leaves
      ? // APPROVED/REJECTED only. Cancelling reuses decidedBy and decidedAt on this
        // model, so without the status filter a leave the person withdrew themselves
        // would be listed here as something YOU decided.
        LeaveRequest.find({ decidedBy: user._id, decidedAt: { $gte: since }, status: { $in: ['APPROVED', 'REJECTED'] } })
          .select(LEAVE_FIELDS)
          .sort({ decidedAt: -1 })
          .limit(100)
          .populate('user', 'name employeeId')
      : [],
    sections.regularizations
      ? Regularization.find({ decidedBy: user._id, decidedAt: { $gte: since } })
          .select(REG_FIELDS)
          .sort({ decidedAt: -1 })
          .limit(100)
          .populate('user', 'name employeeId')
      : [],
    // A rejection sends the task back to PENDING and keeps the reason, so both
    // outcomes are found by "I approved it" or "I left a reason".
    Task.find({
      assignedBy: user._id,
      requiresApproval: true,
      updatedAt: { $gte: since },
      $or: [{ approvedBy: user._id }, { rejectionReason: { $nin: ['', null] } }],
    })
      .select('title owner status approvedBy rejectionReason completedAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(100)
      .populate('owner', 'name employeeId'),
  ]);

  return {
    sections,
    days,
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
    Task.countDocuments({ assignedBy: user._id, requiresApproval: true, submittedAt: { $ne: null }, status: { $ne: 'DONE' } }),
  ]);
  return { leaves, regularizations, tasks, total: leaves + regularizations + tasks };
}
