'use client';

import { AppDialog } from '@/components/glass/app-dialog';
import { StatusBadge } from '@/components/glass/status-badge';
import { formatMoney } from '@/lib/expense';
import { formatYMD } from '@/lib/leave';

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words text-right text-sm font-medium">{children}</span>
    </div>
  );
}

const DUE_STATUS = {
  PAID: { tone: 'success', label: 'Paid' },
  PARTIAL: { tone: 'warning', label: 'Part paid' },
  PENDING: { tone: 'warning', label: 'Pending' },
};

/**
 * One ledger line in full — opened by tapping a row in History, where the summary is
 * necessarily truncated. The caller supplies context actions (settle, remove) via
 * `footer`, the same way the leave history does.
 *
 * A payment carries far less than a due (no item, no source, no status), so the rows
 * are all conditional rather than a fixed grid with blanks in it.
 */
export function DuesEntryDetailDialog({ entry, open, onOpenChange, footer }) {
  const isDue = entry?.kind === 'DUE';

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isDue ? 'Due' : 'Payment'}
      footer={footer}
    >
      {entry ? (
        <div className="space-y-4 py-1">
          <div className="flex flex-wrap items-center gap-2">
            {isDue ? (
              <StatusBadge tone={DUE_STATUS[entry.status]?.tone ?? 'neutral'}>
                {DUE_STATUS[entry.status]?.label ?? entry.status}
              </StatusBadge>
            ) : (
              <StatusBadge tone="success">Payment received</StatusBadge>
            )}
            <span className="text-sm font-semibold tabular-nums">
              {isDue ? '−' : '+'}
              {formatMoney(entry.amount)}
            </span>
          </div>

          <div className="divide-y divide-border/50 rounded-xl bg-foreground/[0.03] px-3 ring-1 ring-border/50">
            {isDue ? (
              <Row label="Item">
                {entry.item ? entry.item : <span className="italic text-muted-foreground">Not named</span>}
              </Row>
            ) : null}
            {isDue && entry.source ? <Row label="From">{entry.source}</Row> : null}
            <Row label="Amount">{formatMoney(entry.amount)}</Row>
            {/* dateYMD, not `date` — the stored instant is IST midnight, so formatting
                it in the browser's own zone can show the previous day. */}
            <Row label="Date">{formatYMD(entry.dateYMD)}</Row>

            {isDue && entry.paid > 0 ? <Row label="Paid in cash">{formatMoney(entry.paid)}</Row> : null}
            {isDue && entry.remaining > 0 ? (
              <Row label="Still owed">
                <span className="text-amber-600 dark:text-amber-300">{formatMoney(entry.remaining)}</span>
              </Row>
            ) : null}
            {/* Settled without cash against this line means an earlier payment absorbed
                it. That pool is every payment, not only a standing advance — so don't
                call it one. */}
            {isDue && entry.status === 'PAID' && !entry.paid ? (
              <Row label="Settled by">
                <span className="text-muted-foreground">An earlier payment</span>
              </Row>
            ) : null}

            <Row label="Note">
              {entry.note ? entry.note : <span className="italic text-muted-foreground">No note</span>}
            </Row>
            {entry.createdBy?.name ? <Row label="Recorded by">{entry.createdBy.name}</Row> : null}
          </div>

          {!isDue ? (
            <p className="text-xs text-muted-foreground">
              Payments clear the oldest unpaid dues first. Anything left over stays as advance.
            </p>
          ) : null}
        </div>
      ) : null}
    </AppDialog>
  );
}
