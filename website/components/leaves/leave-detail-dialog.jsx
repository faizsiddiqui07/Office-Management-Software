'use client';

import { AppDialog } from '@/components/glass/app-dialog';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { LEAVE_TYPE_LABELS, formatRange, formatYMD } from '@/lib/leave';

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words text-right text-sm font-medium">{children}</span>
    </div>
  );
}

const STATUS_LABEL = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };

/**
 * Full details of one leave request. Works for any status; the caller supplies
 * context actions (Edit/Cancel for the applicant, Approve/Reject for approvers)
 * via `footer`. `showApplicant` adds the requester's name (approver view).
 */
export function LeaveDetailDialog({ leave, open, onOpenChange, footer, showApplicant = false, children }) {
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Leave request"
      footer={footer}
    >
      {leave ? (
        <div className="space-y-4 py-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={STATUS_TONES[leave.status] ?? 'neutral'}>
              {STATUS_LABEL[leave.status] ?? leave.status}
            </StatusBadge>
            <span className="text-sm font-medium">{LEAVE_TYPE_LABELS[leave.type] ?? leave.type} leave</span>
            <span className="text-xs text-muted-foreground">
              · {leave.workingDays} day{leave.workingDays === 1 ? '' : 's'}
              {leave.halfDay ? ' (half day)' : ''}
            </span>
          </div>

          <div className="divide-y divide-border/50 rounded-xl bg-foreground/[0.03] px-3 ring-1 ring-border/50">
            {showApplicant && leave.user?.name ? <Row label="Applicant">{leave.user.name}</Row> : null}
            <Row label="Dates">{formatRange(leave.startYMD, leave.endYMD)}</Row>
            <Row label="Working days">{leave.workingDays}</Row>
            {leave.appliedAt ? <Row label="Applied on">{formatYMD(String(leave.appliedAt).slice(0, 10))}</Row> : null}
            {leave.requesterRemaining != null ? (
              <Row label="Their balance">{leave.requesterRemaining} of {leave.requesterQuota ?? '—'} left</Row>
            ) : null}
            <Row label="Reason">{leave.reason ? leave.reason : <span className="italic text-muted-foreground">No reason given</span>}</Row>
            {leave.status !== 'PENDING' && (leave.decidedBy?.name || leave.decisionNote) ? (
              <Row label={leave.status === 'APPROVED' ? 'Approved by' : leave.status === 'REJECTED' ? 'Rejected by' : 'Decided by'}>
                <span className="block">{leave.decidedBy?.name || '—'}</span>
                {leave.decisionNote ? <span className="mt-0.5 block text-xs text-muted-foreground">“{leave.decisionNote}”</span> : null}
              </Row>
            ) : null}
          </div>

          {children}
        </div>
      ) : null}
    </AppDialog>
  );
}
