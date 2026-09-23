'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Activity as ActivityIcon,
  ArrowLeft,
  Award,
  CalendarClock,
  CalendarOff,
  CheckCircle2,
  ChevronRight,
  Clock,
  Coins,
  Download,
  Home,
  ListTodo,
  Plane,
  ShieldAlert,
  TriangleAlert,
  UserCircle,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile, API_BASE_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, roleName } from '@/lib/permissions';
import { DatePicker } from '@/components/ui/date-picker';
import { APP_LIVE_YMD } from '@/lib/app-live';
import { AttendanceStatusBadge, attendanceStatusText } from '@/components/attendance/attendance-status-badge';
import { formatTime, formatDuration, companyYMD } from '@/lib/time';
import { formatYMD } from '@/lib/leave';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/glass/page-header';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { GlassPanel } from '@/components/glass/glass-panel';
import { GlassCard } from '@/components/glass/glass-card';
import { StatCard } from '@/components/glass/stat-card';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { DataTable } from '@/components/glass/data-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUserBonus } from '@/lib/bonus';
import { formatRupees } from '@/lib/expense';
import { EntryDetailDialog } from '@/components/rewards/entry-detail-dialog';
import { Button } from '@/components/ui/button';
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
/** 1st of the current calendar month — "Month" means July, not the last 30 days. */
function monthStart() {
  const d = new Date();
  d.setDate(1);
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

// "This month" is the calendar month so far (1 Jul → today), which is what people
// mean when they ask how someone did this month. The others are rolling windows,
// and their labels say so.
const PRESETS = [
  { key: 'week', label: 'Last 7 days', days: 7 },
  { key: 'month', label: 'This month', calendarMonth: true },
  { key: 'quarter', label: '90 days', days: 90 },
  { key: 'year', label: 'Year', days: 365 },
];

const LEAVE_TONES = { APPROVED: 'success', PENDING: 'warning', REJECTED: 'destructive', CANCELLED: 'neutral' };

export default function UserDossierPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const allowed = !!user && can(user, 'viewEveryone');
  // /bonus/user/:id is behind manageSettings — see backend/src/routes/bonus.routes.js.
  const canSeePoints = !!user && can(user, 'manageSettings');

  const [preset, setPreset] = React.useState('month');
  const [from, setFrom] = React.useState(monthStart());
  const [to, setTo] = React.useState(daysAgo(0));
  const [ledgerBusy, setLedgerBusy] = React.useState(false);
  const [reportBusy, setReportBusy] = React.useState(false);

  const applyPreset = (p) => {
    setPreset(p.key);
    // "90 days" and "Year" reach back before the system went live; clamp them to the
    // same floor the date pickers enforce, or the presets sneak past it.
    const start = p.calendarMonth ? monthStart() : daysAgo(p.days - 1);
    setFrom(start < APP_LIVE_YMD ? APP_LIVE_YMD : start);
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

  const downloadReport = async () => {
    if (!from || !to || to < from) return toast.error('Pick a valid date range first');
    setReportBusy(true);
    try {
      const base = API_BASE_URL;
      await downloadFile(`${base}/api/users/${id}/report.pdf?from=${from}&to=${to}`, `report-${u?.name || id}-${from}_to_${to}.pdf`);
      toast.success('Report downloaded');
    } catch (e) {
      toast.error(e?.message || 'Could not download the report');
    } finally {
      setReportBusy(false);
    }
  };

  const downloadLedger = async () => {
    setLedgerBusy(true);
    try {
      const base = API_BASE_URL;
      const yr = leaves?.balance?.year;
      await downloadFile(`${base}/api/leaves/ledger.pdf?userId=${id}${yr ? `&year=${yr}` : ''}`, `leave-ledger-${u?.name || id}.pdf`);
      toast.success('Leave ledger downloaded');
    } catch (e) {
      toast.error(e?.message || 'Could not download the ledger');
    } finally {
      setLedgerBusy(false);
    }
  };

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
          // Bandi ki asli photo — badi, gol, halki ring ke saath. Photo na ho to initials.
          media={
            u ? (
              <Avatar className="size-16 shadow-lg shadow-primary/10 ring-2 ring-primary/30 ring-offset-2 ring-offset-background sm:size-20">
                {u.avatarUrl ? <AvatarImage src={u.avatarUrl} alt={u.name} /> : null}
                <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary sm:text-xl">
                  {(u.name || '').split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ) : null
          }
          description={
            u
              ? [
                  roleName(u),
                  u.designation,
                  u.department,
                  u.employeeId && `ID ${u.employeeId}`,
                  // When they were given access — every figure below is counted from
                  // this date, so it belongs next to their name.
                  u.dateOfJoining && `Access since ${formatYMD(companyYMD(u.dateOfJoining))}`,
                ]
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
            <DatePicker id="d-from" value={from} min={APP_LIVE_YMD} max={to} onChange={(v) => { setFrom(v); setPreset('custom'); }} className="h-9 w-full bg-background/50 sm:w-40" />
          </div>
          <div className="min-w-0 flex-1 space-y-1 sm:flex-none">
            <Label htmlFor="d-to" className="text-xs text-muted-foreground">To</Label>
            <DatePicker id="d-to" value={to} min={from || APP_LIVE_YMD} max={daysAgo(0)} onChange={(v) => { setTo(v); setPreset('custom'); }} className="h-9 w-full bg-background/50 sm:w-40" />
          </div>
        </div>
        {/* Downloads the full attendance + leave report for exactly the range above.
            Only for roles that self-track — a leader has no attendance to report. */}
        {att?.tracksAttendance ? (
          <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={downloadReport} disabled={reportBusy}>
            <Download className="size-4" /> {reportBusy ? 'Generating…' : 'Download report (PDF)'}
          </Button>
        ) : null}
      </GlassPanel>

      {from && to && to < from ? (
        <EmptyState icon={CalendarClock} title="Invalid date range" description="The end date is before the start date — fix the From/To dates above." />
      ) : isError ? (
        <EmptyState icon={UserCircle} title="Couldn’t load this user" description="Please try again in a moment." />
      ) : isLoading || !data ? (
        <LoadingState label="Loading details…" />
      ) : (
        <>
          {att.countedFrom ? (
            <p className="flex items-start gap-2 rounded-xl bg-foreground/[0.03] p-3 text-xs text-muted-foreground ring-1 ring-border/50">
              <UserPlus className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This period starts before they joined — figures are counted from{' '}
                <span className="font-medium text-foreground">{formatYMD(att.countedFrom)}</span>, the day they got access.
              </span>
            </p>
          ) : null}

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-7">
            {/* WFH days sit inside workingDays, so the hint names them — otherwise the
                ratio reads short and looks like unexplained absences. */}
            <StatCard
              compact
              label="Present"
              value={att.presentDays}
              hint={att.wfhDays ? `of ${att.workingDays} · +${att.wfhDays} from home` : `of ${att.workingDays} working days`}
              icon={CheckCircle2}
              tone="success"
            />
            <StatCard compact label="Late" value={att.lateDays} hint={att.excusedLateDays ? `${att.excusedLateDays} on-duty` : undefined} icon={TriangleAlert} tone="warning" />
            <StatCard compact label="Absent" value={att.tracksAttendance ? att.absentDays : '—'} icon={CalendarOff} tone="destructive" />
            <StatCard compact label="From home" value={att.wfhDays ?? 0} icon={Home} tone="default" />
            <StatCard compact label="Overtime" value={att.totalOvertimeMinutes ? formatDuration(att.totalOvertimeMinutes) : '0m'} icon={Clock} tone="success" />
            <StatCard compact label="Leaves taken" value={leaves.approvedDays} hint={`${leaves.balance.remaining} left`} icon={Plane} />
            <StatCard compact label="Tasks done" value={`${tasks.done}/${tasks.total}`} hint={tasks.pending ? `${tasks.pending} pending` : undefined} icon={ListTodo} />
          </div>

          <Tabs defaultValue="attendance" className="space-y-4">
            {/* Full-width equal tabs on a phone (no side-scroll); natural width on desktop. */}
            <TabsList className={cn('grid w-full sm:inline-flex sm:w-fit', canSeePoints ? 'grid-cols-5' : 'grid-cols-4')}>
              <TabsTrigger value="attendance" className="min-w-0 px-1.5 text-xs sm:px-3.5 sm:text-sm">
                {/* Five equal tabs on a phone leave ~52px of text: "Attendance" is clipped there. */}
                <span className="hidden sm:inline">Attendance</span>
                <span className="sm:hidden">Attend.</span>
              </TabsTrigger>
              <TabsTrigger value="leaves" className="min-w-0 px-1.5 text-xs sm:px-3.5 sm:text-sm">Leaves</TabsTrigger>
              <TabsTrigger value="tasks" className="min-w-0 px-1.5 text-xs sm:px-3.5 sm:text-sm">To-do</TabsTrigger>
              {/* Points come from the rewards endpoint, which is leadership-only — so the
                  tab is there only for someone who may actually load it. */}
              {canSeePoints ? (
                <TabsTrigger value="rewards" className="min-w-0 px-1.5 text-xs sm:px-3.5 sm:text-sm">Rewards</TabsTrigger>
              ) : null}
              <TabsTrigger value="activity" className="min-w-0 px-1.5 text-xs sm:px-3.5 sm:text-sm">Activity</TabsTrigger>
            </TabsList>

            {/* Attendance */}
            <TabsContent value="attendance">
              {!att.tracksAttendance ? (
                <p className="mb-3 rounded-lg bg-foreground/[0.04] px-3 py-2 text-xs text-muted-foreground ring-1 ring-border/50">
                  This role doesn’t self-track attendance, so present/absent counts aren’t applicable.
                </p>
              ) : null}
              {(att.days ?? att.records).length ? (
                // The full day-by-day sheet — present, late, ABSENT and on-leave days all
                // show, not just the days that happen to have a check-in row.
                <DataTable columns={attColumns} data={att.days ?? att.records} searchPlaceholder="Search by date…" pageSize={15} emptyMessage="No attendance in this range." />
              ) : (
                <EmptyState icon={CalendarClock} title="No attendance records" description="Nothing marked in this date range." />
              )}
            </TabsContent>

            {/* Leaves */}
            <TabsContent value="leaves">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-foreground/[0.05] px-2.5 py-1 ring-1 ring-border/50">Balance {leaves.balance.year}: <b className="text-foreground">{leaves.balance.remaining}</b> / {leaves.balance.totalQuota} left</span>
                {Object.entries(leaves.byType).map(([t, d]) => (
                  <span key={t} className="rounded-full bg-foreground/[0.05] px-2.5 py-1 ring-1 ring-border/50">{t}: {d}d</span>
                ))}
                <Button size="sm" variant="outline" className="ml-auto" onClick={downloadLedger} disabled={ledgerBusy}>
                  <Download className="size-3.5" /> {ledgerBusy ? 'Generating…' : 'Leave ledger (PDF)'}
                </Button>
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

            {/* Rewards — points for the months this range touches. */}
            {canSeePoints ? (
              <TabsContent value="rewards">
                <RewardsTab userId={id} from={from} to={to} whose={u?.name} />
              </TabsContent>
            ) : null}

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

/**
 * Their points for the period — the same figures the Rewards page shows, for one person.
 *
 * Points are scored per MONTH, so the window here is the months the chosen range touches;
 * a range inside one month is that month. The hint under the total says which months are
 * counted, so the number is never read as "these exact days".
 */
function RewardsTab({ userId, from, to, whose }) {
  // The points API works in whole MONTHS (that is how points are scored and stored), so
  // ask it for the months this range touches and then keep only the days actually chosen —
  // otherwise "Last 7 days" showed the whole month's points next to seven days of
  // everything else on this page. Each entry carries the day it was earned (earnedYMD),
  // which is exactly what the filter needs.
  const months = { from: String(from).slice(0, 7), to: String(to).slice(0, 7) };
  const oneMonth = months.from === months.to;
  const { data, isLoading, isError } = useUserBonus(userId, oneMonth ? { month: months.from } : months);
  // The entry the person tapped — same detail view as on the Rewards page.
  const [viewing, setViewing] = React.useState(null);

  // Day of an entry: earnedYMD when it is there (the day the late arrival / finished task
  // actually happened), else the day the row was written.
  const dayOf = (e) => e.earnedYMD || String(e.createdAt || '').slice(0, 10);
  const inRange = React.useCallback(
    (e) => {
      const d = dayOf(e);
      return !!d && d >= from && d <= to;
    },
    [from, to],
  );

  const periodLabel = `${fmtDate(from)} – ${fmtDate(to)}`;

  if (isError) {
    return <EmptyState icon={Award} title="Couldn’t load points" description="Please try again in a moment." />;
  }
  if (isLoading || !data) return <LoadingState label="Loading points…" />;
  if (!data.enabled) {
    return (
      <EmptyState
        icon={Award}
        title="Points are switched off"
        description="Monthly reward points aren’t running right now. Turn them on in Settings to start scoring."
      />
    );
  }

  // Points for THESE days, counted from the entries themselves. Safe to add up:
  // carry-forward is off, so a period's total is just the sum of what it holds
  // (see mySummary in backend/src/services/bonus.service.js).
  const entries = (data.entries ?? []).filter(inRange);
  const points = entries.reduce((n, e) => n + (e.points || 0), 0);
  const rupees = data.rupeesPerPoint && points > 0 ? Math.round(points * data.rupeesPerPoint) : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard compact label="Points" value={points} hint={periodLabel} icon={Award} tone="success" />
        <StatCard
          compact
          label="Worth"
          value={formatRupees(rupees)}
          hint={data.rupeesPerPoint ? `${formatRupees(data.rupeesPerPoint)} a point` : undefined}
          icon={Coins}
        />
        <StatCard compact label="Entries" value={entries.length} hint="in this period" icon={ListTodo} />
      </div>

      <GlassPanel className="p-0">
        {entries.length ? (
          <ul className="divide-y divide-border/50">
            {entries.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setViewing(e)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.04] focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm">{e.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(e.earnedYMD || String(e.createdAt).slice(0, 10))}
                      {e.source === 'manual' ? ' · awarded' : ' · automatic'}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-sm font-semibold tabular-nums',
                      e.points < 0 ? 'text-destructive' : 'text-success',
                    )}
                  >
                    {e.points > 0 ? `+${e.points}` : e.points}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">No points between {periodLabel}.</p>
        )}
      </GlassPanel>

      {/* Tap a point for where it came from — for a task, the whole task. */}
      <EntryDetailDialog entry={viewing} onOpenChange={(o) => (!o ? setViewing(null) : null)} whose={whose} />
    </div>
  );
}
