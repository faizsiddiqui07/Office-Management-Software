'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, TriangleAlert, UserCheck, Users, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, prettyRole } from '@/lib/permissions';
import { DataTable } from '@/components/glass/data-table';
import { StatCard } from '@/components/glass/stat-card';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { TableSkeleton } from '@/components/glass/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatTime, formatDuration, todayYMD } from '@/lib/time';

export function EveryoneTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canExcuse = !!user && can(user, 'approveRegularization');
  const [date, setDate] = React.useState(todayYMD());

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', 'overview', date],
    queryFn: () => api.get(`/attendance/overview?date=${date}`),
  });

  const excuseMut = useMutation({
    mutationFn: ({ id, excused }) => api.post(`/attendance/${id}/excuse`, { excused }),
    onSuccess: (_res, vars) => {
      toast.success(vars.excused ? 'Marked as on-duty / excused' : 'Excuse removed');
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not update'),
  });

  const rows = data?.rows ?? [];
  const summary = data?.summary;
  const unexcusedLate = Math.max(0, (summary?.late ?? 0) - (summary?.excused ?? 0));

  const columns = React.useMemo(
    () =>
      [
        {
          id: 'employee',
          header: 'Employee',
          accessorFn: (r) => `${r.user.name} ${r.user.employeeId}`,
          cell: ({ row }) => (
            <div>
              <p className="font-medium">{row.original.user.name}</p>
              <p className="text-xs text-muted-foreground">
                {row.original.user.employeeId} · {row.original.user.department || '—'}
              </p>
            </div>
          ),
        },
        {
          id: 'role',
          header: 'Role',
          accessorFn: (r) => r.user.role,
          cell: ({ row }) => <span className="text-sm text-muted-foreground">{prettyRole(row.original.user.role)}</span>,
        },
        { id: 'in', header: 'In', cell: ({ row }) => formatTime(row.original.attendance?.checkInAt) },
        { id: 'out', header: 'Out', cell: ({ row }) => formatTime(row.original.attendance?.checkOutAt) },
        { id: 'worked', header: 'Worked', cell: ({ row }) => formatDuration(row.original.attendance?.workedMinutes) },
        {
          id: 'status',
          header: 'Status',
          cell: ({ row }) => (
            <div className="flex flex-col items-start gap-1">
              <StatusBadge tone={STATUS_TONES[row.original.status] ?? 'neutral'}>
                {row.original.status.replace('_', ' ')}
              </StatusBadge>
              {row.original.attendance?.excused ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success ring-1 ring-success/20">
                  <Check className="size-3" /> On-duty
                </span>
              ) : null}
            </div>
          ),
        },
        {
          id: 'reason',
          header: 'Late reason',
          cell: ({ row }) => {
            const a = row.original.attendance;
            if (row.original.status !== 'LATE' || !a) return <span className="text-xs text-muted-foreground">—</span>;
            const cat = a.lateReason?.category;
            const note = a.lateReason?.note;
            if (!cat && !note) return <span className="text-xs italic text-muted-foreground">No reason given</span>;
            return (
              <div className="max-w-[220px]">
                {cat ? <p className="text-xs font-medium">{cat}</p> : null}
                {note ? (
                  <p className="truncate text-xs text-muted-foreground" title={note}>
                    {note}
                  </p>
                ) : null}
              </div>
            );
          },
        },
        canExcuse && {
          id: 'action',
          header: '',
          cell: ({ row }) => {
            const a = row.original.attendance;
            if (row.original.status !== 'LATE' || !a) return null;
            return (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant={a.excused ? 'outline' : 'ghost'}
                  disabled={excuseMut.isPending}
                  onClick={() => excuseMut.mutate({ id: a.id, excused: !a.excused })}
                  className={a.excused ? '' : 'text-primary'}
                >
                  {a.excused ? 'Excused ✓' : 'Excuse'}
                </Button>
              </div>
            );
          },
        },
      ].filter(Boolean),
    [canExcuse, excuseMut],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Total staff" value={summary?.total ?? '—'} icon={Users} />
        <StatCard label="Present" value={(summary?.present ?? 0) + (summary?.late ?? 0)} icon={UserCheck} tone="success" />
        <StatCard
          label={summary?.excused ? `Late (${summary.excused} on-duty)` : 'Late'}
          value={unexcusedLate}
          icon={TriangleAlert}
          tone="warning"
        />
        <StatCard label="Absent" value={summary?.absent ?? 0} icon={UserX} tone="destructive" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Everyone · {data?.date ?? date}</h3>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Label htmlFor="ov-date" className="text-sm text-muted-foreground">
            Date
          </Label>
          <Input
            id="ov-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full bg-background/50 sm:w-44"
          />
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : (
        <DataTable columns={columns} data={rows} searchPlaceholder="Search staff…" pageSize={10} emptyMessage="No staff found." />
      )}
    </div>
  );
}
