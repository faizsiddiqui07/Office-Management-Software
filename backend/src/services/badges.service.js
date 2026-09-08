import { Task } from '../models/Task.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { Regularization } from '../models/Regularization.js';
import { Announcement } from '../models/Announcement.js';
import { can } from '../lib/permissions.js';
import { reviewableByFilter, sieveReviewable } from '../lib/taskApprovers.js';

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
  // Work I've passed on isn't waiting on me any more, and it no longer appears in my
  // list — so it must not light the dot either, or the dot points at nothing.
  const passedOn = await Task.distinct('forwardedFrom', { assignedBy: mine, forwardedFrom: { $ne: null } });
  const notPassedOn = passedOn.length ? { _id: { $nin: passedOn } } : {};

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
    latest(Task, { owner: mine, assignedBy: { $ne: null }, status: 'PENDING', ...notPassedOn }, 'createdAt'),
    // Work waiting on MY sign-off: what I handed out, plus anything I was tagged on
    // (owner's rule, 8 Sep 2026). Not `latest()`, because the rule has a part no single
    // query can express — work I did myself further down a forward chain isn't mine to
    // sign off, and a dot pointing at a button that refuses me is worse than no dot.
    // Newest first, so the first row that survives the sieve is the answer.
    (async () => {
      const rows = await Task.find({ ...reviewableByFilter(mine), status: 'PENDING' })
        .select('owner assignedBy collaborators completedBy requiresApproval submittedAt status')
        .sort({ submittedAt: -1 })
        .limit(200);
      const mineToSign = await sieveReviewable(rows, mine);
      return mineToSign.length ? mineToSign[0].submittedAt : null;
    })(),

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
    // The inbox is only for people holding an approval duty, so its dot has to be
    // silent for everybody else — including someone whose own delegated work is
    // waiting, since they approve that in To-Do, where the `todo` dot already covers it.
    approvals:
      can(user, 'approveLeave') || can(user, 'approveRegularization')
        ? newest(leaveToApprove, fixToApprove, awaitingMyApproval)
        : null,
  };
}
