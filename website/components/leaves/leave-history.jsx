'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { DataTable } from '@/components/glass/data-table';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { TableSkeleton } from '@/components/glass/skeletons';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import { Button } from '@/components/ui/button';
import { LEAVE_TYPE_LABELS, formatRange } from '@/lib/leave';
import { LeaveDetailDialog } from './leave-detail-dialog';
import { ApplyLeaveDialog } from './apply-leave-dialog';

const columns = [
  { id: 'type', header: 'Type', accessorFn: (r) => r.type, cell: ({ row }) => LEAVE_TYPE_LABELS[row.original.type] ?? row.original.type },
  { id: 'range', header: 'Dates', accessorFn: (r) => r.startYMD, cell: ({ row }) => formatRange(row.original.startYMD, row.original.endYMD) },
  { id: 'days', header: 'Days', accessorFn: (r) => r.workingDays, cell: ({ row }) => <span className="tabular-nums">{row.original.workingDays}</span> },
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
    accessorFn: (r) => r.status,
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
];

export function LeaveHistory() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['leaves', 'mine'],
    queryFn: () => api.get('/leaves'),
  });
  const requests = data?.requests ?? [];

  const [viewing, setViewing] = React.useState(null); // row-click detail
  const [editing, setEditing] = React.useState(null); // pending request being edited
  const [cancelling, setCancelling] = React.useState(null);

  const cancelMut = useMutation({
    mutationFn: (id) => api.post(`/leaves/${id}/cancel`),
    onSuccess: () => {
      toast.success('Request cancelled');
      setCancelling(null);
      setViewing(null);
      qc.invalidateQueries({ queryKey: ['leaves'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not cancel'),
  });

  if (isLoading) return <TableSkeleton rows={5} cols={5} />;

  const isPending = viewing?.status === 'PENDING';

  return (
    <>
      <DataTable
        columns={columns}
        data={requests}
        searchable={false}
        pageSize={10}
        emptyMessage="No leave requests yet — apply for your first one."
        onRowClick={setViewing}
      />

      {/* Detail — tap any row. Pending requests can be edited or cancelled here. */}
      <LeaveDetailDialog
        leave={viewing}
        open={!!viewing}
        onOpenChange={(o) => (!o ? setViewing(null) : null)}
        footer={
          isPending ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" className="text-destructive" onClick={() => setCancelling(viewing)}>
                Cancel request
              </Button>
              <Button
                onClick={() => {
                  const l = viewing;
                  setViewing(null);
                  setEditing(l);
                }}
              >
                <Pencil className="size-4" /> Edit
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
          )
        }
      />

      {editing ? (
        <ApplyLeaveDialog leave={editing} open={!!editing} onOpenChange={(o) => (!o ? setEditing(null) : null)} />
      ) : null}

      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => (!o ? setCancelling(null) : null)}
        title="Cancel this leave request?"
        description="The request will be withdrawn — you can apply again later if needed."
        tone="destructive"
        confirmLabel="Cancel request"
        loading={cancelMut.isPending}
        onConfirm={() => cancelling && cancelMut.mutate(cancelling.id)}
      />
    </>
  );
}
