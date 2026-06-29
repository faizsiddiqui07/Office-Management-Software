'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { DataTable } from '@/components/glass/data-table';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { TableSkeleton } from '@/components/glass/skeletons';
import { Button } from '@/components/ui/button';
import { LEAVE_TYPE_LABELS, formatRange } from '@/lib/leave';

function CancelButton({ id }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => api.post(`/leaves/${id}/cancel`),
    onSuccess: () => {
      toast.success('Request cancelled');
      qc.invalidateQueries({ queryKey: ['leaves'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not cancel'),
  });
  return (
    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => mut.mutate()} disabled={mut.isPending}>
      Cancel
    </Button>
  );
}

const columns = [
  { id: 'type', header: 'Type', accessorFn: (r) => r.type, cell: ({ row }) => LEAVE_TYPE_LABELS[row.original.type] ?? row.original.type },
  { id: 'range', header: 'Dates', cell: ({ row }) => formatRange(row.original.startYMD, row.original.endYMD) },
  { id: 'days', header: 'Days', cell: ({ row }) => <span className="tabular-nums">{row.original.workingDays}</span> },
  {
    id: 'reason',
    header: 'Reason',
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.reason || '—'}</span>,
  },
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
