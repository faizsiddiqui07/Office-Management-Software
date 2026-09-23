'use client';

import { AppDialog } from '@/components/glass/app-dialog';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { formatYMD } from '@/lib/leave';

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words text-right text-sm font-medium">{children}</span>
    </div>
  );
}

const STATUS_LABEL = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };

/**
 * Full details of one attendance correction — the counterpart of LeaveDetailDialog, so a
 * correction reads the same wherever it is listed (your own on Attendance, a decided one
 * in the approvals history). The caller supplies any actions via `footer`;
 * `showApplicant` adds whose correction it is (approver view).
 *
 * Times are stored and shown as 24h "HH:mm", like everywhere else in the app.
 */
export function RegularizationDetailDialog({ request, open, onOpenChange, footer, showApplicant = false, children }) {
  const r = request;
  return (
    <AppDialog open={open} onOpenChange={onOpenChange} title="Attendance correction" footer={footer}>
      {r ? (
        <div className="space-y-4 py-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={STATUS_TONES[r.status] ?? 'warning'}>
              {STATUS_LABEL[r.status] ?? r.status}
            </StatusBadge>
            <span className="text-sm font-medium">{formatYMD(r.dateYMD)}</span>
          </div>

          <div className="divide-y divide-border/50 rounded-xl bg-foreground/[0.03] px-3 ring-1 ring-border/50">
            {showApplicant && r.user?.name ? <Row label="Requested by">{r.user.name}</Row> : null}
            <Row label="Date">{formatYMD(r.dateYMD)}</Row>
            <Row label="Check-in">
              {r.requestedCheckIn || <span className="italic text-muted-foreground">No change</span>}
            </Row>
            <Row label="Check-out">
              {r.requestedCheckOut || <span className="italic text-muted-foreground">No change</span>}
            </Row>
            {r.createdAt ? <Row label="Requested on">{formatYMD(String(r.createdAt).slice(0, 10))}</Row> : null}
            <Row label="Reason">
              {r.reason ? r.reason : <span className="italic text-muted-foreground">No reason given</span>}
            </Row>
            {r.status !== 'PENDING' && (r.decidedBy?.name || r.decisionNote || r.decidedAt) ? (
              <Row label={r.decidedBy?.name ? (r.status === 'APPROVED' ? 'Approved by' : 'Rejected by') : (r.status === 'APPROVED' ? 'Approved' : 'Rejected')}>
                {/* Your own list doesn't carry who decided it — then the date and the note
                    are the whole answer, and a bare dash would read as missing data. */}
                {r.decidedBy?.name ? <span className="block">{r.decidedBy.name}</span> : null}
                {r.decidedAt ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    on {formatYMD(String(r.decidedAt).slice(0, 10))}
                  </span>
                ) : null}
                {r.decisionNote ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">“{r.decisionNote}”</span>
                ) : null}
              </Row>
            ) : null}
          </div>

          {children}
        </div>
      ) : null}
    </AppDialog>
  );
}
