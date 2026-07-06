'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Activity as ActivityIcon,
  ArrowLeft,
  CalendarClock,
  CalendarOff,
  CheckCircle2,
  Clock,
  ListTodo,
  Plane,
  ShieldAlert,
  TriangleAlert,
  UserCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, roleName } from '@/lib/permissions';
import { AttendanceStatusBadge, attendanceStatusText } from '@/components/attendance/attendance-status-badge';
import { formatTime, formatDuration } from '@/lib/time';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/glass/page-header';
import { GlassPanel } from '@/components/glass/glass-panel';
import { GlassCard } from '@/components/glass/glass-card';
import { StatCard } from '@/components/glass/stat-card';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { DataTable } from '@/components/glass/data-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function localYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localYMD(d);
}
function fmtDate(ymd) {
  if (!ymd) return '—';
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}
function prettyAction(a) {
  return String(a || '')
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const PRESETS = [
  { key: 'week', label: 'Week', days: 7 },
  { key: 'month', label: 'Month', days: 30 },
  { key: 'quarter', label: '90 days', days: 90 },
  { key: 'year', label: 'Year', days: 365 },
];

const LEAVE_TONES = { APPROVED: 'success', PENDING: 'warning', REJECTED: 'destructive', CANCELLED: 'neutral' };

export default function UserDossierPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const allowed = !!user && can(user, 'viewEveryone');

  const [preset, setPreset] = React.useState('month');
  const [from, setFrom] = React.useState(daysAgo(29));
  const [to, setTo] = React.useState(daysAgo(0));

  const applyPreset = (p) => {
    setPreset(p.key);
    setFrom(daysAgo(p.days - 1));
    setTo(daysAgo(0));
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dossier', id, from, to],
    queryFn: () => api.get(`/users/${id}/dossier?from=${from}&to=${to}`),
    enabled: allowed && !!id && !!from && !!to && to >= from,
  });

  if (!allowed) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Team member" title="User details" icon={UserCircle} />
        <EmptyState icon={ShieldAlert} title="No access" description="Only leadership can view another person's full details." />
      </div>
    );
  }

  const u = data?.user;
  const att = data?.attendance;
  const leaves = data?.leaves;
  const tasks = data?.tasks;
  const activity = data?.activity ?? [];

  const attColumns = [
    // Search matches both typed forms ("2026-07-01" and "1 Jul") plus the status label.
    {
      id: 'date',
      header: 'Date',
      accessorFn: (r) => `${r.dateYMD} ${fmtDate(r.dateYMD)} ${attendanceStatusText(r, r.status)}`,
      cell: ({ row }) => <span className="whitespace-nowrap text-sm">{fmtDate(row.original.dateYMD)}</span>,
    },
    { id: 'in', header: 'In', cell: ({ row }) => formatTime(row.original.checkInAt) },
    { id: 'out', header: 'Out', cell: ({ row }) => formatTime(row.original.checkOutAt) },
    { id: 'worked', header: 'Worked', cell: ({ row }) => formatDuration(row.original.workedMinutes) },
    {
      id: 'ot',
      header: 'Overtime',
      cell: ({ row }) =>
        row.original.overtimeMinutes ? (
          <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-300">+{formatDuration(row.original.overtimeMinutes)}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (r) => attendanceStatusText(r, r.status),
      cell: ({ row }) => <AttendanceStatusBadge attendance={row.original} fallback={row.original.status} />,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-2 -ml-2 text-muted-foreground">
          <ArrowLeft className="size-4" /> Back
        </Button>
        <PageHeader
          eyebrow="Team member"
          title={u?.name || 'Loading…'}
          icon={UserCircle}
          description={
            u
              ? [roleName(u), u.designation, u.department, u.employeeId && `ID ${u.employeeId}`]
                  .filter(Boolean)
                  .join(' · ')
              : undefined
          }
        />
      </div>

      {/* Filters */}
      <GlassPanel className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p.key}
              type="button"
              size="sm"
              variant={preset === p.key ? 'default' : 'outline'}
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </Button>
          ))}
          <Button type="button" size="sm" variant={preset === 'custom' ? 'default' : 'outline'} onClick={() => setPreset('custom')}>
            Custom
          </Button>
        </div>
        <div className="flex w-full items-end gap-2 sm:w-auto">
          <div className="min-w-0 flex-1 space-y-1 sm:flex-none">
            <Label htmlFor="d-from" className="text-xs text-muted-foreground">From</Label>
            <Input id="d-from" type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }} className="h-9 w-full bg-background/50 sm:w-40" />
          </div>
          <div className="min-w-0 flex-1 space-y-1 sm:flex-none">
            <Label htmlFor="d-to" className="text-xs text-muted-foreground">To</Label>
            <Input id="d-to" type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPreset('custom'); }} className="h-9 w-full bg-background/50 sm:w-40" />
          </div>
        </div>
      </GlassPanel>

      {from && to && to < from ? (
        <EmptyState icon={CalendarClock} title="Invalid date range" description="The end date is before the start date — fix the From/To dates above." />
      ) : isError ? (
        <EmptyState icon={UserCircle} title="Couldn’t load this user" description="Please try again in a moment." />
      ) : isLoading || !data ? (
        <LoadingState label="Loading details…" />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Present" value={att.presentDays} hint={`of ${att.workingDays} working days`} icon={CheckCircle2} tone="success" />
            <StatCard label="Late" value={att.lateDays} hint={att.excusedLateDays ? `${att.excusedLateDays} on-duty` : undefined} icon={TriangleAlert} tone="warning" />
            <StatCard label="Absent" value={att.tracksAttendance ? att.absentDays : '—'} icon={CalendarOff} tone="destructive" />
            <StatCard label="Overtime" value={att.totalOvertimeMinutes ? formatDuration(att.totalOvertimeMinutes) : '0m'} icon={Clock} tone="success" />
            <StatCard label="Leaves taken" value={leaves.approvedDays} hint={`${leaves.balance.remaining} left`} icon={Plane} />
            <StatCard label="Tasks done" value={`${tasks.done}/${tasks.total}`} hint={tasks.pending ? `${tasks.pending} pending` : undefined} icon={ListTodo} />
          </div>

          <Tabs defaultValue="attendance" className="space-y-4">
            {/* Full-width equal tabs on a phone (no side-scroll); natural width on desktop. */}
            <TabsList className="grid w-full grid-cols-4 sm:inline-flex sm:w-fit">
              <TabsTrigger value="attendance" className="min-w-0 px-1.5 text-xs sm:px-3.5 sm:text-sm">Attendance</TabsTrigger>
              <TabsTrigger value="leaves" className="min-w-0 px-1.5 text-xs sm:px-3.5 sm:text-sm">Leaves</TabsTrigger>
              <TabsTrigger value="tasks" className="min-w-0 px-1.5 text-xs sm:px-3.5 sm:text-sm">To-do</TabsTrigger>
              <TabsTrigger value="activity" className="min-w-0 px-1.5 text-xs sm:px-3.5 sm:text-sm">Activity</TabsTrigger>
            </TabsList>

            {/* Attendance */}
            <TabsContent value="attendance">
              {!att.tracksAttendance ? (
                <p className="mb-3 rounded-lg bg-foreground/[0.04] px-3 py-2 text-xs text-muted-foreground ring-1 ring-border/50">
                  This role doesn’t self-track attendance, so present/absent counts aren’t applicable.
                </p>
              ) : null}
              {att.records.length ? (
                <DataTable columns={attColumns} data={att.records} searchPlaceholder="Search by date…" pageSize={15} emptyMessage="No attendance in this range." />
              ) : (
                <EmptyState icon={CalendarClock} title="No attendance records" description="Nothing marked in this date range." />
              )}
            </TabsContent>

            {/* Leaves */}
            <TabsContent value="leaves">
              <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-foreground/[0.05] px-2.5 py-1 ring-1 ring-border/50">Balance {leaves.balance.year}: <b className="text-foreground">{leaves.balance.remaining}</b> / {leaves.balance.totalQuota} left</span>
                {Object.entries(leaves.byType).map(([t, d]) => (
                  <span key={t} className="rounded-full bg-foreground/[0.05] px-2.5 py-1 ring-1 ring-border/50">{t}: {d}d</span>
                ))}
              </div>
              {leaves.requests.length ? (
                <div className="space-y-2.5">
                  {leaves.requests.map((l) => (
                    <GlassCard key={l.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={LEAVE_TONES[l.status] ?? 'neutral'}>{l.status}</StatusBadge>
                          <span className="text-sm font-medium">{l.type}</span>
                          <span className="text-xs text-muted-foreground">· {l.workingDays} day{l.workingDays === 1 ? '' : 's'}</span>
                        </div>
                        <p className="mt-1 text-sm">{fmtDate(l.startYMD)}{l.endYMD !== l.startYMD ? ` → ${fmtDate(l.endYMD)}` : ''}{l.halfDay ? ' (half day)' : ''}</p>
                        {l.reason ? <p className="text-xs text-muted-foreground">{l.reason}</p> : null}
                      </div>
                    </GlassCard>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Plane} title="No leaves" description="No leave requests in this range." />
              )}
            </TabsContent>

            {/* Tasks */}
            <TabsContent value="tasks">
              {tasks.items.length ? (
                <div className="space-y-2.5">
                  {tasks.items.map((t) => (
                    <GlassCard key={t.id} className="flex items-start justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={t.status === 'DONE' ? 'success' : 'warning'}>{t.status === 'DONE' ? 'Done' : 'Pending'}</StatusBadge>
                          <span className={cn('text-sm font-medium', t.status === 'DONE' && 'line-through text-muted-foreground')}>{t.title}</span>
                        </div>
                        {t.notes ? <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{t.notes}</p> : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t.assignedBy?.name ? `By ${t.assignedBy.name}` : 'Personal'}
                          {t.dueYMD ? ` · due ${fmtDate(t.dueYMD)}` : ''}
                        </p>
                      </div>
                    </GlassCard>
                  ))}
                </div>
              ) : (
                <EmptyState icon={ListTodo} title="No tasks" description="No to-do items created in this range." />
              )}
            </TabsContent>

            {/* Activity */}
            <TabsContent value="activity">
              {activity.length ? (
                <GlassPanel className="p-2">
                  <ul className="divide-y divide-border/50">
                    {activity.map((a) => (
                      <li key={a.id} className="flex items-start gap-3 px-3 py-2.5">
                        <ActivityIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">
                            {prettyAction(a.action)}
                            {a.entityType ? <span className="text-muted-foreground"> · {a.entityType}</span> : null}
                          </p>
                          <p className="text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </GlassPanel>
              ) : (
                <EmptyState icon={ActivityIcon} title="No activity" description="No recorded activity in this range." />
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
