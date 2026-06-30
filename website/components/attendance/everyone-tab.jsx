'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, TriangleAlert, UserCheck, Users, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, prettyRole } from '@/lib/permissions';
import { effectiveStatus, attendanceStatusLabel } from '@/lib/attendance';
import { DataTable } from '@/components/glass/data-table';
import { StatCard } from '@/components/glass/stat-card';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { TableSkeleton } from '@/components/glass/skeletons';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatTime, formatDuration, todayYMD } from '@/lib/time';

const columns = [
  {
    id: 'employee',
    header: 'Employee',
    accessorFn: (r) => `${r.user.name} ${r.user.employeeId}`,
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.original.user.name}</p>
        <p className="truncate text-xs text-muted-foreground">
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
    cell: ({ row }) => {
      const s = effectiveStatus(row.original.attendance, row.original.status);
      return <StatusBadge tone={STATUS_TONES[s] ?? 'neutral'}>{attendanceStatusLabel(s)}</StatusBadge>;
    },
  },
  {
    id: 'reason',
    header: 'Late reason',
    cell: ({ row }) => {
      const a = row.original.attendance;
      if (row.original.status !== 'LATE' || !a) return <span className="text-xs text-muted-foreground">—</span>;
      const cat = a.lateReason?.category;
      const note = a.lateReason?.note;
      if (!cat && !note) return <span className="text-xs italic text-muted-foreground">No reason</span>;
      return (
        <span className="block max-w-[180px] truncate text-xs text-muted-foreground" title={[cat, note].filter(Boolean).join(' · ')}>
          {cat || note}
        </span>
      );
    },
  },
];

function Field({ label, value }) {
  return (
    <div className="rounded-lg bg-foreground/[0.04] p-2.5 ring-1 ring-border/50">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

export function EveryoneTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canExcuse = !!user && can(user, 'approveRegularization');
  const [date, setDate] = React.useState(todayYMD());
  const [selected, setSelected] = React.useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', 'overview', date],
    queryFn: () => api.get(`/attendance/overview?date=${date}`),
  });

  const excuseMut = useMutation({
    mutationFn: ({ id, excused }) => api.post(`/attendance/${id}/excuse`, { excused }),
    onSuccess: (_res, vars) => {
      toast.success(vars.excused ? 'Marked as on-duty / excused' : 'Excuse removed');
      setSelected((s) => (s && s.attendance ? { ...s, attendance: { ...s.attendance, excused: vars.excused } } : s));
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not update'),
  });

  const rows = data?.rows ?? [];
  const summary = data?.summary;
  const unexcusedLate = Math.max(0, (summary?.late ?? 0) - (summary?.excused ?? 0));

  const sel = selected;
  const a = sel?.attendance;
  const selStatus = sel ? effectiveStatus(a, sel.status) : null;
  const isLateRow = !!a && a.status === 'LATE';
  const cat = a?.lateReason?.category;
  const note = a?.lateReason?.note;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
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

      <p className="text-xs text-muted-foreground">Tip: tap any row for full details{canExcuse ? ' and to excuse a late' : ''}.</p>

      {isLoading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          searchPlaceholder="Search staff…"
          pageSize={10}
          emptyMessage="No staff found."
          onRowClick={setSelected}
        />
      )}

      <AppDialog
        open={!!sel}
        onOpenChange={(o) => (!o ? setSelected(null) : null)}
        title={sel?.user?.name}
        description={
          sel ? `${sel.user.employeeId} · ${prettyRole(sel.user.role)}${sel.user.department ? ` · ${sel.user.department}` : ''}` : undefined
        }
        footer={
          canExcuse && isLateRow ? (
            <Button
              variant={a?.excused ? 'outline' : 'default'}
              disabled={excuseMut.isPending}
              onClick={() => excuseMut.mutate({ id: a.id, excused: !a.excused })}
            >
              {excuseMut.isPending ? 'Saving…' : a?.excused ? 'Remove excuse' : 'Excuse (mark on-duty)'}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
          )
        }
      >
        {sel ? (
          <div className="space-y-4 py-1">
            <div className="flex flex-wrap items-center gap-2">
              {selStatus ? (
                <StatusBadge tone={STATUS_TONES[selStatus] ?? 'neutral'}>{attendanceStatusLabel(selStatus)}</StatusBadge>
              ) : null}
              <span className="text-xs text-muted-foreground">{data?.date ?? date}</span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Field label="Check-in" value={formatTime(a?.checkInAt)} />
              <Field label="Check-out" value={formatTime(a?.checkOutAt)} />
              <Field label="Worked" value={formatDuration(a?.workedMinutes)} />
            </div>

            {isLateRow ? (
              <div className="rounded-xl bg-foreground/[0.04] p-3 ring-1 ring-border/50">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Late reason</p>
                {cat || note ? (
                  <>
                    {cat ? <p className="mt-1 text-sm font-medium">{cat}</p> : null}
                    {note ? <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">{note}</p> : null}
                  </>
                ) : (
                  <p className="mt-1 text-sm italic text-muted-foreground">No reason given.</p>
                )}
                {a?.excused ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-success/20">
                    <Check className="size-3.5" /> Marked on-duty (excused)
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </AppDialog>
    </div>
  );
}
