'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { DataTable } from '@/components/glass/data-table';
import { StatCard } from '@/components/glass/stat-card';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { TableSkeleton } from '@/components/glass/skeletons';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatTime, formatDuration, formatDayLabel, recentMonths } from '@/lib/time';
import { effectiveStatus, attendanceStatusLabel } from '@/lib/attendance';

const columns = [
  { accessorKey: 'date', header: 'Date', cell: ({ row }) => formatDayLabel(row.original.date) },
  { accessorKey: 'checkInAt', header: 'In', cell: ({ row }) => formatTime(row.original.checkInAt) },
  { accessorKey: 'checkOutAt', header: 'Out', cell: ({ row }) => formatTime(row.original.checkOutAt) },
  { accessorKey: 'workedMinutes', header: 'Worked', cell: ({ row }) => formatDuration(row.original.workedMinutes) },
  {
    accessorKey: 'overtimeMinutes',
    header: 'Overtime',
    cell: ({ row }) => (
      <span className={row.original.overtimeMinutes ? 'font-medium text-primary' : ''}>
        {formatDuration(row.original.overtimeMinutes)}
      </span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const s = effectiveStatus(row.original);
      return (
        <StatusBadge tone={STATUS_TONES[s] ?? 'neutral'}>{attendanceStatusLabel(s)}</StatusBadge>
      );
    },
  },
];

export function AttendanceHistory() {
  const months = React.useMemo(() => recentMonths(6), []);
  const [sel, setSel] = React.useState(months[0].key);
  const month = months.find((m) => m.key === sel) ?? months[0];

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', 'history', month.from, month.to],
    queryFn: () => api.get(`/attendance?from=${month.from}&to=${month.to}&limit=100`),
  });
  const records = React.useMemo(() => data?.records ?? [], [data]);

  const summary = React.useMemo(() => {
    const present = records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
    const late = records.filter((r) => r.status === 'LATE' && !r.excused).length; // excused = on-duty, not late
    const overtime = records.reduce((s, r) => s + (r.overtimeMinutes || 0), 0);
    return { present, late, overtime };
  }, [records]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Days present" value={summary.present} icon={CalendarDays} tone="success" />
        <StatCard label="Late arrivals" value={summary.late} icon={TriangleAlert} tone="warning" />
        <StatCard label="Total overtime" value={formatDuration(summary.overtime)} icon={Clock} tone="info" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">History</h3>
        <Select value={sel} onValueChange={setSel}>
          <SelectTrigger className="w-full sm:w-48 bg-background/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m.key} value={m.key}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : (
        <DataTable
          columns={columns}
          data={records}
          searchable={false}
          pageSize={12}
          emptyMessage="No attendance records this month."
        />
      )}
    </div>
  );
}
