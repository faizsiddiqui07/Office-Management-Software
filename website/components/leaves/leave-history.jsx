'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { DataTable } from '@/components/glass/data-table';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { TableSkeleton } from '@/components/glass/skeletons';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import { Button } from '@/components/ui/button';
import { LEAVE_TYPE_LABELS, formatRange } from '@/lib/leave';

function CancelButton({ id }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = React.useState(false);
  const mut = useMutation({
    mutationFn: () => api.post(`/leaves/${id}/cancel`),
    onSuccess: () => {
      toast.success('Request cancelled');
      setConfirming(false);
      qc.invalidateQueries({ queryKey: ['leaves'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not cancel'),
  });
  return (
    <>
      <Button variant="ghost" className="h-10 text-destructive sm:h-8" onClick={() => setConfirming(true)} disabled={mut.isPending}>
        Cancel
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Cancel this leave request?"
        description="The request will be withdrawn — you can apply again later if needed."
        tone="destructive"
        confirmLabel="Cancel request"
        loading={mut.isPending}
        onConfirm={() => mut.mutate()}
      />
    </>
  );
}

const columns = [
  { id: 'type', header: 'Type', accessorFn: (r) => r.type, cell: ({ row }) => LEAVE_TYPE_LABELS[row.original.type] ?? row.original.type },
  { id: 'range', header: 'Dates', cell: ({ row }) => formatRange(row.original.startYMD, row.original.endYMD) },
  { id: 'days', header: 'Days', cell: ({ row }) => <span className="tabular-nums">{row.original.workingDays}</span> },
  {
    id: 'reason',
    header: 'Reason',
    cell: ({ row }) => (
      <span className="block max-w-[220px] text-muted-foreground line-clamp-2 break-words" title={row.original.reason || ''}>
        {row.original.reason || '—'}
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const r = row.original;
      const decided = r.status !== 'PENDING' && (r.decidedBy?.name || r.decisionNote);
      return (
        <div className="space-y-1">
          <StatusBadge tone={STATUS_TONES[r.status] ?? 'neutral'}>{r.status}</StatusBadge>
          {/* Show who decided + their note, so a rejection is never unexplained. */}
          {decided ? (
            <p className="max-w-[220px] text-xs text-muted-foreground line-clamp-2 break-words" title={r.decisionNote || ''}>
              {r.decidedBy?.name ? `By ${r.decidedBy.name}` : ''}
              {r.decisionNote ? `${r.decidedBy?.name ? ' — ' : ''}“${r.decisionNote}”` : ''}
            </p>
          ) : null}
        </div>
      );
    },
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => (row.original.status === 'PENDING' ? <CancelButton id={row.original.id} /> : null),
  },
];

export function LeaveHistory() {
  const { data, isLoading } = useQuery({
    queryKey: ['leaves', 'mine'],
    queryFn: () => api.get('/leaves'),
  });
  const requests = data?.requests ?? [];

  if (isLoading) return <TableSkeleton rows={5} cols={6} />;

  return (
    <DataTable
      columns={columns}
      data={requests}
      searchable={false}
      pageSize={10}
      emptyMessage="No leave requests yet — apply for your first one."
    />
  );
}
