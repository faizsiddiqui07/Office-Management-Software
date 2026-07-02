'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import { DataTable } from '@/components/glass/data-table';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { TableSkeleton } from '@/components/glass/skeletons';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LEAVE_TYPE_LABELS, formatRange } from '@/lib/leave';
import { LeaveDetailDialog } from './leave-detail-dialog';

export function RequestsQueue() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = React.useState('PENDING');
  const [viewing, setViewing] = React.useState(null); // row-click detail
  const [note, setNote] = React.useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['leaves', 'queue', statusFilter],
    queryFn: () =>
      api.get(`/leaves?queue=true${statusFilter !== 'ALL' ? `&status=${statusFilter}` : ''}`),
  });
  const requests = data?.requests ?? [];

  const mut = useMutation({
    mutationFn: ({ id, action, note: n }) => api.post(`/leaves/${id}/decision`, { decision: action, note: n }),
    onSuccess: (_d, vars) => {
      toast.success(`Leave ${vars.action === 'APPROVE' ? 'approved' : 'rejected'}`);
      qc.invalidateQueries({ queryKey: ['leaves'] });
      setViewing(null);
      setNote('');
    },
    onError: (e) => toast.error(e?.message || 'Could not submit decision'),
  });

  const open = (row) => {
    setNote('');
    setViewing(row);
  };

  const columns = React.useMemo(
    () => [
      {
        id: 'requester',
        header: 'Requester',
        accessorFn: (r) => `${r.user?.name ?? ''} ${r.user?.employeeId ?? ''}`,
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.user?.name}</p>
            <p className="text-xs text-muted-foreground">
              Remaining: {row.original.requesterRemaining ?? '—'} / {row.original.requesterQuota ?? '—'}
            </p>
          </div>
        ),
      },
      { id: 'type', header: 'Type', accessorFn: (r) => LEAVE_TYPE_LABELS[r.type] ?? r.type, cell: ({ row }) => LEAVE_TYPE_LABELS[row.original.type] ?? row.original.type },
      { id: 'range', header: 'Dates', accessorFn: (r) => r.startYMD, cell: ({ row }) => formatRange(row.original.startYMD, row.original.endYMD) },
      { id: 'days', header: 'Days', accessorFn: (r) => r.workingDays, cell: ({ row }) => <span className="tabular-nums">{row.original.workingDays}</span> },
      {
        id: 'reason',
        header: 'Reason',
        cell: ({ row }) => (
          <span className="block max-w-[220px] text-sm text-muted-foreground line-clamp-2 break-words" title={row.original.reason || ''}>
            {row.original.reason || '—'}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (r) => r.status,
        cell: ({ row }) => (
          <StatusBadge tone={STATUS_TONES[row.original.status] ?? 'neutral'}>{row.original.status}</StatusBadge>
        ),
      },
    ],
    [],
  );

  const isPending = viewing?.status === 'PENDING';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Approval queue · tap a row to review</h3>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40 bg-background/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
            <SelectItem value="ALL">All statuses</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : (
        <DataTable columns={columns} data={requests} searchPlaceholder="Search requester…" pageSize={10} emptyMessage="Nothing in the queue." onRowClick={open} />
      )}

      {/* Detail — tap any row. Pending requests can be approved/rejected here. */}
      <LeaveDetailDialog
        leave={viewing}
        open={!!viewing}
        onOpenChange={(o) => (!o ? (setViewing(null), setNote('')) : null)}
        showApplicant
        footer={
          isPending ? (
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => mut.mutate({ id: viewing.id, action: 'REJECT', note })} disabled={mut.isPending}>
                <X className="size-4" /> Reject
              </Button>
              <Button onClick={() => mut.mutate({ id: viewing.id, action: 'APPROVE', note })} disabled={mut.isPending}>
                <Check className="size-4" /> Approve
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
          )
        }
      >
        {isPending ? (
          <div className="space-y-2">
            <Label htmlFor="dec-note">Note for the employee (optional)</Label>
            <Textarea
              id="dec-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Approved — enjoy! / Rejected because…"
              className="bg-background/50"
            />
          </div>
        ) : null}
      </LeaveDetailDialog>
    </div>
  );
}
