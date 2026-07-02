'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import { DataTable } from '@/components/glass/data-table';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { TableSkeleton } from '@/components/glass/skeletons';
import { AppDialog } from '@/components/glass/app-dialog';
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

export function RequestsQueue() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = React.useState('PENDING');
  const [decision, setDecision] = React.useState(null); // { request, action }
  const [note, setNote] = React.useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['leaves', 'queue', statusFilter],
    queryFn: () =>
      api.get(`/leaves?queue=true${statusFilter !== 'ALL' ? `&status=${statusFilter}` : ''}`),
  });
  const requests = data?.requests ?? [];

  const close = () => {
    setDecision(null);
    setNote('');
  };

  const mut = useMutation({
    mutationFn: ({ id, action, note: n }) => api.post(`/leaves/${id}/decision`, { decision: action, note: n }),
    onSuccess: (_d, vars) => {
      toast.success(`Leave ${vars.action === 'APPROVE' ? 'approved' : 'rejected'}`);
      qc.invalidateQueries({ queryKey: ['leaves'] });
      close();
    },
    onError: (e) => toast.error(e?.message || 'Could not submit decision'),
  });

  const columns = React.useMemo(
    () => [
      {
        id: 'requester',
        header: 'Requester',
        accessorFn: (r) => r.user?.name ?? '',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.user?.name}</p>
            <p className="text-xs text-muted-foreground">
              Remaining: {row.original.requesterRemaining ?? '—'} / {row.original.requesterQuota ?? '—'}
            </p>
          </div>
        ),
      },
      { id: 'type', header: 'Type', cell: ({ row }) => LEAVE_TYPE_LABELS[row.original.type] ?? row.original.type },
      { id: 'range', header: 'Dates', cell: ({ row }) => formatRange(row.original.startYMD, row.original.endYMD) },
      { id: 'days', header: 'Days', cell: ({ row }) => <span className="tabular-nums">{row.original.workingDays}</span> },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <StatusBadge tone={STATUS_TONES[row.original.status] ?? 'neutral'}>{row.original.status}</StatusBadge>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          row.original.status === 'PENDING' ? (
            <div className="flex flex-wrap gap-2">
              <Button className="h-10 sm:h-8" onClick={() => { setDecision({ request: row.original, action: 'APPROVE' }); setNote(''); }}>
                <Check className="size-4" /> Approve
              </Button>
              <Button variant="outline" className="h-10 sm:h-8" onClick={() => { setDecision({ request: row.original, action: 'REJECT' }); setNote(''); }}>
                <X className="size-4" /> Reject
              </Button>
            </div>
          ) : null,
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Approval queue</h3>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40 bg-background/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="ALL">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : (
        <DataTable columns={columns} data={requests} searchPlaceholder="Search requester…" pageSize={10} emptyMessage="Nothing in the queue." />
      )}

      <AppDialog
        open={!!decision}
        onOpenChange={(o) => {
          if (!o) close();
        }}
        title={decision?.action === 'APPROVE' ? 'Approve leave' : 'Reject leave'}
        description={
          decision
            ? `${decision.request.user?.name} · ${decision.request.workingDays} day(s) · ${LEAVE_TYPE_LABELS[decision.request.type]}`
            : ''
        }
        footer={
          <>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              variant={decision?.action === 'REJECT' ? 'destructive' : 'default'}
              onClick={() => decision && mut.mutate({ id: decision.request.id, action: decision.action, note })}
              disabled={mut.isPending}
            >
              {mut.isPending ? 'Saving…' : decision?.action === 'APPROVE' ? 'Approve' : 'Reject'}
            </Button>
          </>
        }
      >
        <div className="space-y-2 py-2">
          <Label htmlFor="dec-note">Note (optional)</Label>
          <Textarea
            id="dec-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note for the employee…"
            className="bg-background/50"
          />
        </div>
      </AppDialog>
    </div>
  );
}
