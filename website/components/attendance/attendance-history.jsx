'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock, TriangleAlert, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { DataTable } from '@/components/glass/data-table';
import { StatCard } from '@/components/glass/stat-card';
import { Button } from '@/components/ui/button';
import { AttendanceStatusBadge, attendanceStatusText } from './attendance-status-badge';
import { RegularizationDialog } from './regularization-dialog';
import { TableSkeleton } from '@/components/glass/skeletons';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatTime, formatDuration, formatDayLabel, recentMonths, todayYMD } from '@/lib/time';

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
    id: 'status',
    header: 'Status',
    // Sort/search by the text actually shown ("Present (late)" etc.), not the raw enum.
    accessorFn: (r) => attendanceStatusText(r),
    cell: ({ row }) => <AttendanceStatusBadge attendance={row.original} />,
  },
  {
    id: 'fix',
    header: '',
    enableSorting: false,
    // E7: a past day with a check-in but no check-out is a forgotten checkout. Instead of
    // hunting for the correction form and re-typing the date, offer a one-tap "Fix" that
    // opens it already seeded with that day. Today's still-open shift is left alone — they
    // may yet check out.
    cell: ({ row }) => {
      const r = row.original;
      const forgotCheckout = !!r.checkInAt && !r.checkOutAt && r.date < todayYMD();
      if (!forgotCheckout) return null;
      return (
        <RegularizationDialog
          prefill={{ dateYMD: r.date, reason: 'Forgot to check out' }}
          trigger={
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-amber-600 hover:text-amber-600 dark:text-amber-400">
              <Wrench className="size-3.5" /> Fix
            </Button>
          }
        />
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
    // Worked from home — days that would otherwise appear in no stat at all.
    const wfh = records.filter((r) => r.status === 'WFH').length;
    const overtime = records.reduce((s, r) => s + (r.overtimeMinutes || 0), 0);
    return { present, late, wfh, overtime };
  }, [records]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Days present"
          value={summary.present}
          icon={CalendarDays}
          tone="success"
          hint={summary.wfh ? `+${summary.wfh} from home` : undefined}
        />
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
        <TableSkeleton rows={6} cols={7} />
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
