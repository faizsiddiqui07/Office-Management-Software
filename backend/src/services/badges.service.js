import { Task } from '../models/Task.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { Regularization } from '../models/Regularization.js';
import { Announcement } from '../models/Announcement.js';
import { can } from '../lib/permissions.js';

/** Newest of a set of dates, ignoring nulls. */
function newest(...dates) {
  const times = dates.filter(Boolean).map((d) => new Date(d).getTime());
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

async function latest(model, filter, field) {
  const doc = await model.findOne(filter).sort({ [field]: -1 }).select(field);
  return doc ? doc[field] : null;
}

/**
 * "When did something last appear here that this person hasn't dealt with?" — one
 * timestamp per sidebar section, so the client can show a dot when it's newer than
 * the last time they opened that section.
 *
 * Only genuinely actionable things count: work waiting on THEM. What's actionable
 * depends on the role, so an approver's leave section reacts to incoming requests
 * while everyone else's reacts to their own request being decided.
 */
export async function getBadges(user) {
  const mine = user._id;

  const [
    assignedToMe,
    awaitingMyApproval,
    leaveToApprove,
    myLeaveDecided,
    fixToApprove,
    myFixDecided,
    announcement,
  ] = await Promise.all([
    // A task someone delegated to me that I haven't finished.
    latest(Task, { owner: mine, assignedBy: { $ne: null }, status: 'PENDING' }, 'createdAt'),
    // Work I assigned that's now submitted and waiting for my approval.
    latest(Task, { assignedBy: mine, requiresApproval: true, status: 'PENDING', submittedAt: { $ne: null } }, 'submittedAt'),

    can(user, 'approveLeave')
      ? latest(LeaveRequest, { status: 'PENDING', user: { $ne: mine } }, 'createdAt')
      : null,
    latest(LeaveRequest, { user: mine, decidedAt: { $ne: null } }, 'decidedAt'),

    can(user, 'approveRegularization')
      ? latest(Regularization, { status: 'PENDING', user: { $ne: mine } }, 'createdAt')
      : null,
    latest(Regularization, { user: mine, decidedAt: { $ne: null } }, 'decidedAt'),

    latest(Announcement, {}, 'createdAt'),
  ]);

  return {
    todo: newest(assignedToMe, awaitingMyApproval),
    leaves: newest(leaveToApprove, myLeaveDecided),
    attendance: newest(fixToApprove, myFixDecided),
    announcements: newest(announcement),
    // The inbox gathers the three things that need a DECISION from this person, so
    // its dot is the newest of exactly those — not the same as the leaves or
    // attendance dots, which also react to your own request being answered.
    approvals: newest(leaveToApprove, fixToApprove, awaitingMyApproval),
  };
}
