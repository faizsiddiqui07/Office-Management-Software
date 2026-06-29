'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlert, UserCheck, Users, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { DataTable } from '@/components/glass/data-table';
import { StatCard } from '@/components/glass/stat-card';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { TableSkeleton } from '@/components/glass/skeletons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { prettyRole } from '@/lib/permissions';
import { formatTime, formatDuration, todayYMD } from '@/lib/time';

const columns = [
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
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {prettyRole(row.original.user.role)}
      </span>
    ),
  },
  { id: 'in', header: 'In', cell: ({ row }) => formatTime(row.original.attendance?.checkInAt) },
  { id: 'out', header: 'Out', cell: ({ row }) => formatTime(row.original.attendance?.checkOutAt) },
  { id: 'worked', header: 'Worked', cell: ({ row }) => formatDuration(row.original.attendance?.workedMinutes) },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusBadge tone={STATUS_TONES[row.original.status] ?? 'neutral'}>
        {row.original.status.replace('_', ' ')}
      </StatusBadge>
    ),
  },
];

export function EveryoneTab() {
  const [date, setDate] = React.useState(todayYMD());

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', 'overview', date],
    queryFn: () => api.get(`/attendance/overview?date=${date}`),
  });

  const rows = data?.rows ?? [];
  const summary = data?.summary;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Total staff" value={summary?.total ?? '—'} icon={Users} />
        <StatCard label="Present" value={(summary?.present ?? 0) + (summary?.late ?? 0)} icon={UserCheck} tone="success" />
        <StatCard label="Late" value={summary?.late ?? 0} icon={TriangleAlert} tone="warning" />
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
        <TableSkeleton rows={6} cols={6} />
      ) : (
        <DataTable columns={columns} data={rows} searchPlaceholder="Search staff…" pageSize={10} emptyMessage="No staff found." />
      )}
    </div>
  );
}
