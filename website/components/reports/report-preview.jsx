'use client';

import { CalendarClock, CalendarDays, Clock, UserCheck, UserPlus, UserX, Users, Wallet } from 'lucide-react';
import { StatCard } from '@/components/glass/stat-card';
import { GlassCard } from '@/components/glass/glass-card';
import { DataTable } from '@/components/glass/data-table';
import { StatusBadge } from '@/components/glass/status-badge';
import { formatDuration } from '@/lib/time';
import { formatMoney, categoryLabel } from '@/lib/expense';
import { formatRange, formatYMD } from '@/lib/leave';
import { prettyRole, roleName } from '@/lib/permissions';
import { useRoleOptions } from '@/lib/use-roles';

/**
 * A clearly-bounded card for ONE report section: an icon + title + short summary
 * in a header bar, content below. On a phone this gives every section an obvious
 * start and end, so a long report doesn't blur into one confusing scroll.
 */
function ReportSection({ icon: Icon, title, meta, children }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 shadow-sm ring-1 ring-white/5">
      <header className="flex items-center gap-2.5 border-b border-border/50 bg-foreground/[0.04] px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
          <Icon className="size-4" />
        </span>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {meta ? <span className="ml-auto shrink-0 text-right text-xs font-medium text-muted-foreground">{meta}</span> : null}
      </header>
      <div className="space-y-4 p-3 sm:p-4">{children}</div>
    </section>
  );
}

function AttendanceSection({ data }) {
  const t = data.attendance.totals;
  const columns = [
    {
      id: 'name',
      header: 'Employee',
      accessorFn: (r) => `${r.name} ${r.employeeId} ${roleName(r)}`,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.employeeId} · {roleName(row.original)}
          </p>
        </div>
      ),
    },
    { id: 'present', header: 'Present', accessorFn: (r) => r.present, cell: ({ row }) => <span className="tabular-nums">{row.original.present}</span> },
    { id: 'late', header: 'Came late', accessorFn: (r) => r.late, cell: ({ row }) => <span className="tabular-nums">{row.original.late}</span> },
    { id: 'absent', header: 'Absent', accessorFn: (r) => r.absent, cell: ({ row }) => <span className="tabular-nums">{row.original.absent}</span> },
    { id: 'onLeave', header: 'On leave', accessorFn: (r) => r.onLeave, cell: ({ row }) => <span className="tabular-nums">{row.original.onLeave}</span> },
    { id: 'worked', header: 'Worked', accessorFn: (r) => r.workedHours, cell: ({ row }) => <span className="tabular-nums">{row.original.workedHours}h</span> },
    { id: 'ot', header: 'OT', accessorFn: (r) => r.overtimeMinutes, cell: ({ row }) => <span className="tabular-nums">{formatDuration(row.original.overtimeMinutes)}</span> },
  ];
  return (
    <ReportSection icon={CalendarClock} title="Attendance" meta={`${data.workingDays} working days`}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Attendance rate" value={`${t.attendanceRate}%`} icon={UserCheck} tone="success" hint={`${data.workingDays} working days`} />
        <StatCard label="Present" value={t.present} icon={CalendarDays} tone="default" hint={t.late ? `${t.late} came late` : 'nobody late'} />
        <StatCard label="Absent / Leave" value={`${t.absent} / ${t.onLeave}`} icon={UserX} tone="warning" />
        <StatCard label="Overtime" value={formatDuration(t.overtimeMinutes)} icon={Clock} tone="info" hint={`${t.workedHours}h worked`} />
      </div>
      <DataTable columns={columns} data={data.attendance.perEmployee} searchPlaceholder="Search employees…" pageSize={8} emptyMessage="No employees." />
    </ReportSection>
  );
}

function LeavesSection({ data }) {
  const takenCols = [
    { id: 'name', header: 'Employee', accessorFn: (r) => r.name, cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: 'type', header: 'Type', accessorFn: (r) => r.type, cell: ({ row }) => row.original.type },
    { id: 'dates', header: 'Dates', accessorFn: (r) => r.startYMD, cell: ({ row }) => formatRange(row.original.startYMD, row.original.endYMD) },
    { id: 'days', header: 'Days', accessorFn: (r) => r.days, cell: ({ row }) => <span className="tabular-nums">{row.original.days}</span> },
  ];
  const balCols = [
    { id: 'name', header: 'Employee', accessorFn: (r) => r.name, cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: 'used', header: 'Used', accessorFn: (r) => r.used, cell: ({ row }) => <span className="tabular-nums">{row.original.used}</span> },
    { id: 'remaining', header: 'Remaining', accessorFn: (r) => r.remaining, cell: ({ row }) => <span className="tabular-nums">{row.original.remaining}</span> },
    { id: 'total', header: 'Quota', accessorFn: (r) => r.total, cell: ({ row }) => <span className="tabular-nums">{row.original.total}</span> },
  ];
  return (
    <ReportSection icon={CalendarDays} title="Leaves" meta={`${data.leaves.taken.length} taken · ${data.leaves.pending.length} pending`}>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Taken this period</h3>
        {data.leaves.taken.length ? (
          <DataTable columns={takenCols} data={data.leaves.taken} searchable={false} pageSize={6} emptyMessage="No leaves." />
        ) : (
          <p className="rounded-lg bg-foreground/[0.03] p-3 text-sm text-muted-foreground ring-1 ring-border/50">No approved leaves in this period.</p>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Remaining balances</h3>
        <DataTable columns={balCols} data={data.leaves.balances} searchPlaceholder="Search…" pageSize={6} emptyMessage="No balances." />
      </div>
    </ReportSection>
  );
}

function ExpensesSection({ data }) {
  const e = data.expenses;
  const listCols = [
    { id: 'date', header: 'Date', accessorFn: (r) => r.dateYMD, cell: ({ row }) => formatYMD(row.original.dateYMD) },
    {
      id: 'title',
      header: 'Title',
      accessorFn: (r) => `${r.title} ${r.vendor || ''} ${categoryLabel(r.category)}`,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.title}</p>
          {row.original.vendor ? <p className="text-xs text-muted-foreground">{row.original.vendor}</p> : null}
        </div>
      ),
    },
    { id: 'cat', header: 'Category', accessorFn: (r) => categoryLabel(r.category), cell: ({ row }) => <StatusBadge tone="primary" dot={false}>{categoryLabel(row.original.category)}</StatusBadge> },
    { id: 'amount', header: 'Amount', accessorFn: (r) => r.amount, cell: ({ row }) => <span className="font-medium tabular-nums">{formatMoney(row.original.amount)}</span> },
  ];
  return (
    <ReportSection icon={Wallet} title="Expenses" meta={`${formatMoney(e.total)} · ${e.count} entries`}>
      {e.byCategory.length ? (
        <div className="space-y-2 rounded-lg bg-foreground/[0.03] p-3 ring-1 ring-border/50">
          {e.byCategory.map((c) => (
            <div key={c.category} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{categoryLabel(c.category)}</span>
              <span className="font-medium tabular-nums">{formatMoney(c.total)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {e.list.length ? (
        <DataTable columns={listCols} data={e.list} searchPlaceholder="Search…" pageSize={8} emptyMessage="No expenses." />
      ) : (
        <p className="rounded-lg bg-foreground/[0.03] p-3 text-sm text-muted-foreground ring-1 ring-border/50">No expenses in this period.</p>
      )}
    </ReportSection>
  );
}

function RosterSection({ data }) {
  const cols = [
    { id: 'name', header: 'Name', accessorFn: (r) => `${r.name} ${r.employeeId} ${roleName(r)} ${r.department || ''}`, cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: 'id', header: 'ID', accessorFn: (r) => r.employeeId, cell: ({ row }) => <span className="text-sm tabular-nums text-muted-foreground">{row.original.employeeId}</span> },
    { id: 'role', header: 'Role', accessorFn: (r) => roleName(r), cell: ({ row }) => <StatusBadge tone="primary" dot={false}>{roleName(row.original)}</StatusBadge> },
    { id: 'dept', header: 'Department', accessorFn: (r) => r.department || '', cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.department || '—'}</span> },
  ];
  return (
    <ReportSection icon={Users} title="Roster" meta={`${data.roster.headcount} staff`}>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(data.roster.byRole).map(([r, n]) => (
          <StatusBadge key={r} tone="neutral" dot={false}>
            {prettyRole(r)}: {n}
          </StatusBadge>
        ))}
      </div>
      <DataTable columns={cols} data={data.roster.members} searchPlaceholder="Search staff…" pageSize={8} emptyMessage="No members." />
    </ReportSection>
  );
}

/* No dues section here, by design: what the office is owed isn't company reporting.
   Each person sees their own ledger on the Dues page and in their own report. */

/**
 * Shown when the selected period hasn't finished yet (e.g. a yearly report taken
 * mid-year). Makes clear the numbers only cover elapsed days, so nobody reads the
 * uncounted future as "absent". Reused by the company preview and the self report.
 */
export function OngoingNotice({ data, workingDays }) {
  if (!data?.ongoing) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-warning/10 p-3 text-sm ring-1 ring-warning/25">
      <Clock className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">{data.period.label}</span> is still in progress — figures cover{' '}
        <span className="font-medium text-foreground">
          {formatYMD(data.period.from)} – {formatYMD(data.asOfYMD)}
        </span>
        {workingDays != null ? (
          <>
            {' '}(<span className="font-medium text-foreground">{workingDays}</span> working days so far)
          </>
        ) : null}
        . Upcoming days aren’t counted as absent.
      </p>
    </div>
  );
}

/**
 * People who joined after this period and so aren't in it. Stated plainly, because a
 * report that quietly omits names is worse than one that explains the omission.
 */
export function JoinedLaterNotice({ data }) {
  const later = data?.joinedLater ?? [];
  if (!later.length) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-foreground/[0.03] p-3 text-sm ring-1 ring-border/50">
      <UserPlus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">
          {later.length} {later.length > 1 ? 'people are' : 'person is'} not in this report
        </span>{' '}
        — they joined after {formatYMD(data.period.to)}:{' '}
        {later.map((p) => `${p.name} (joined ${formatYMD(p.joinedYMD)})`).join(', ')}.
      </p>
    </div>
  );
}

export function ReportPreview({ data, sections }) {
  // Warm the role-label cache so the roster's per-role count chips (bare keys)
  // render edited names, and re-render once labels arrive.
  useRoleOptions();
  const has = (s) => sections.includes(s);
  return (
    <div className="space-y-4">
      <OngoingNotice data={data} workingDays={data.workingDays} />
      <JoinedLaterNotice data={data} />
      {has('attendance') && data.attendance ? <AttendanceSection data={data} /> : null}
      {has('leaves') && data.leaves ? <LeavesSection data={data} /> : null}
      {has('expenses') && data.expenses ? <ExpensesSection data={data} /> : null}
      {has('roster') && data.roster ? <RosterSection data={data} /> : null}
    </div>
  );
}
