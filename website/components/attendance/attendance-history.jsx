'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock, TriangleAlert, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { DataTable } from '@/components/glass/data-table';
import { StatCard } from '@/components/glass/stat-card';
import { Button } from '@/components/ui/button';
import { AttendanceStatusBadge, attendanceStatusText } from './attendance-status-badge';
import { SelfieView } from './selfie-view';
import { RegularizationDialog } from './regularization-dialog';
import { TableSkeleton } from '@/components/glass/skeletons';
import { PeriodFilter } from '@/components/glass/period-filter';
import { resolvePeriod } from '@/lib/date-period';
import { formatTime, formatDuration, formatDayLabel, todayYMD } from '@/lib/time';

/** Is din selfie se attendance lagi thi? */
const hasSelfie = (r) => !!(r.checkInMeta?.selfieKey || r.checkOutMeta?.selfieKey);

const ALL_COLUMNS = [
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
    id: 'selfie',
    header: 'Selfie',
    enableSorting: false,
    // Selfie wale check-in par late nahi lagti, isliye wo saaf dikhna CHAHIYE — chhupa hua
    // nahi. Yahi iska ikloata control hai (owner ka faisla): penalty nahi, par nazar bani
    // rahe. Photo kaun dekh sakta hai ye server tay karta hai — apni row hamesha, baaki
    // tabhi jab viewEveryone ho.
    cell: ({ row }) => {
      const r = row.original;
      const hasIn = !!r.checkInMeta?.selfieKey;
      const hasOut = !!r.checkOutMeta?.selfieKey;
      if (!hasIn && !hasOut) return null;
      return (
        <span className="flex flex-col items-start gap-0.5">
          {hasIn ? <SelfieView attendanceId={r.id} which="in" /> : null}
          {hasOut ? <SelfieView attendanceId={r.id} which="out" /> : null}
        </span>
      );
    },
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
  // This window is a SERVER query, so "All time" is deliberately not on offer: it
  // would pull every day a long-serving person has ever worked to draw ten rows.
  // Opens on the current month, exactly where the old month picker opened.
  const [period, setPeriod] = React.useState({ preset: 'this_month', from: '', to: '' });
  const range = resolvePeriod(period);

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', 'history', range.from, range.to],
    queryFn: () => {
      // Both sides optional: a half-filled custom range still returns something
      // instead of leaving the table stuck on its skeleton.
      //
      // 100 is the server's own ceiling (attendance.validators.js caps `limit`),
      // and asking for more is a 422, not a bigger page — which is exactly how
      // this table came back empty the first time. Three months is ~92 working
      // days, so every chip fits; only a long CUSTOM range can hit the ceiling,
      // and the line under the table says so when it does.
      const qs = new URLSearchParams({ limit: '100' });
      if (range.from) qs.set('from', range.from);
      if (range.to) qs.set('to', range.to);
      return api.get(`/attendance?${qs.toString()}`);
    },
  });
  const records = React.useMemo(() => data?.records ?? [], [data]);
  const clipped = (data?.total ?? 0) > records.length;

  // Selfie ka column SIRF tab dikhta hai jab is window me kam se kam ek din selfie se
  // attendance lagi ho. Ye site par jaane walon ke liye hai — office me baithne wale
  // ke liye wo poore mahine ek khaali khamba tha. Ginti POORI window par hai, sirf
  // is page par nahi: warna agla page kholte hi column gayab ho jata aur table hil jati.
  const showSelfie = React.useMemo(() => records.some(hasSelfie), [records]);
  const columns = React.useMemo(
    () => (showSelfie ? ALL_COLUMNS : ALL_COLUMNS.filter((c) => c.id !== 'selfie')),
    [showSelfie],
  );

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
        <PeriodFilter
          value={period}
          onChange={setPeriod}
          presets={['this_month', 'last_month', 'last_3', 'custom']}
          max={todayYMD()}
          className="w-full sm:w-auto"
        />
      </div>

      {/* Never let a window quietly show less than it holds. */}
      {clipped ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Showing the {records.length} most recent days of {data.total} in this window — pick a shorter one to see the rest.
        </p>
      ) : null}

      {isLoading ? (
        <TableSkeleton rows={6} cols={8} />
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
