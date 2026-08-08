'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DataTable } from '@/components/glass/data-table';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
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
import { requestTypeLabel, isWFHType, formatRange } from '@/lib/leave';
import { LeaveDetailDialog } from './leave-detail-dialog';
import { CoverageWarning } from './coverage-warning';

export function RequestsQueue() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [statusFilter, setStatusFilter] = React.useState('ALL'); // show the whole queue first, not just pending
  const [viewing, setViewing] = React.useState(null); // row-click detail
  const [note, setNote] = React.useState('');
  const [cancelling, setCancelling] = React.useState(null); // approved leave being cancelled

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

  // Cancel an ALREADY-APPROVED leave — restores the balance and clears the ON_LEAVE days.
  const cancelMut = useMutation({
    mutationFn: (id) => api.post(`/leaves/${id}/cancel`),
    onSuccess: () => {
      toast.success('Approved leave cancelled — balance restored');
      qc.invalidateQueries({ queryKey: ['leaves'] });
      setCancelling(null);
      setViewing(null);
    },
    onError: (e) => toast.error(e?.message || 'Could not cancel'),
  });

  // Who may cancel an approved leave: an approver, but never their own (self-dealing) —
  // and an approved WFH day only the owner tier can undo. Mirrors the server's rule so the
  // button only shows when it will actually work.
  const canCancelApproved = (l) =>
    !!l && l.status === 'APPROVED'
    && String(l.user?.id ?? l.user) !== String(me?.id)
    && (!isWFHType(l.type) || me?.isOwner);

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
            {/* For a WFH request the leave balance is the wrong number — it comes out of
                the yearly work-from-home allowance, not the leave quota. */}
            <p className="text-xs text-muted-foreground">
              {isWFHType(row.original.type)
                ? `WFH left: ${row.original.requesterWfhRemaining ?? '—'} / ${row.original.requesterWfhCap ?? 2}`
                : `Remaining: ${row.original.requesterRemaining ?? '—'} / ${row.original.requesterQuota ?? '—'}`}
            </p>
          </div>
        ),
      },
      { id: 'type', header: 'Type', accessorFn: (r) => requestTypeLabel(r.type), cell: ({ row }) => requestTypeLabel(row.original.type) },
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
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {canCancelApproved(viewing) ? (
                <Button variant="ghost" className="mr-auto text-destructive" onClick={() => setCancelling(viewing)} disabled={cancelMut.isPending}>
                  <X className="size-4" /> Cancel approved leave
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
            </div>
          )
        }
      >
        {viewing ? <CoverageWarning leave={viewing} /> : null}
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

      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => (!o ? setCancelling(null) : null)}
        title="Cancel this approved leave?"
        description={
          cancelling
            ? `${cancelling.user?.name}'s ${requestTypeLabel(cancelling.type)} (${formatRange(cancelling.startYMD, cancelling.endYMD)}) will be cancelled — the balance goes back and those days stop being marked on leave.`
            : ''
        }
        tone="destructive"
        confirmLabel="Cancel leave"
        loading={cancelMut.isPending}
        onConfirm={() => cancelling && cancelMut.mutate(cancelling.id)}
      />
    </div>
  );
}
