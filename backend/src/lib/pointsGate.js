/**
 * Is this task's points-eligibility decision FINAL — i.e. must it not be re-derived?
 *
 * A delegated task only earns points if somebody in the owner tier can see it: either
 * they assigned it, or one of them is tagged on it. That question is answered fresh on
 * every award and on every housekeeping pass — which is correct right up until the
 * person it depends on is deleted. From that moment the honest answer is not "no", it
 * is "unanswerable": the evidence is the thing that was removed. Answering "no" instead
 * hard-deletes points that belong to whoever DID the work, in both directions — the
 * doer's award and a late assignee's accrued penalties alike.
 *
 * So deletion freezes the decision as it stood when the points were written, and every
 * consumer asks here rather than testing the field by name. The fallback covers the one
 * build that shipped this under the narrower name `assignerDeleted`, before the
 * collaborator case showed that the assigner is not the only way in.
 */
export function gateFrozen(task) {
  return !!(task?.pointsGateFrozen || task?.assignerDeleted);
}

/** The projection fields any query must select for gateFrozen() to answer truthfully. */
export const GATE_FIELDS = 'pointsGateFrozen assignerDeleted';
