'use client';

import { CalendarDays, Clock, UserCheck, UserX } from 'lucide-react';
import { StatCard } from '@/components/glass/stat-card';
import { GlassCard } from '@/components/glass/glass-card';
import { DataTable } from '@/components/glass/data-table';
import { StatusBadge } from '@/components/glass/status-badge';
import { formatDuration } from '@/lib/time';
import { formatMoney, categoryLabel } from '@/lib/expense';
import { formatRange, formatYMD } from '@/lib/leave';
import { prettyRole, roleName } from '@/lib/permissions';
import { useRoleOptions } from '@/lib/use-roles';

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
    <section className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Attendance</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Attendance rate" value={`${t.attendanceRate}%`} icon={UserCheck} tone="success" hint={`${data.workingDays} working days`} />
        <StatCard
          label="Present"
          value={t.present}
          icon={CalendarDays}
          tone="default"
          hint={t.late ? `${t.late} came late` : 'nobody late'}
        />
        <StatCard label="Absent / Leave" value={`${t.absent} / ${t.onLeave}`} icon={UserX} tone="warning" />
        <StatCard label="Overtime" value={formatDuration(t.overtimeMinutes)} icon={Clock} tone="info" hint={`${t.workedHours}h worked`} />
      </div>
      <DataTable columns={columns} data={data.attendance.perEmployee} searchPlaceholder="Search employees…" pageSize={8} emptyMessage="No employees." />
    </section>
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
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Leaves</h2>
        <span className="text-sm text-muted-foreground">{data.leaves.taken.length} taken · {data.leaves.pending.length} pending</span>
      </div>
      {data.leaves.taken.length ? (
        <DataTable columns={takenCols} data={data.leaves.taken} searchable={false} pageSize={6} emptyMessage="No leaves." />
      ) : (
        <GlassCard className="p-5 text-sm text-muted-foreground">No approved leaves in this period.</GlassCard>
      )}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Remaining balances</h3>
        <DataTable columns={balCols} data={data.leaves.balances} searchPlaceholder="Search…" pageSize={6} emptyMessage="No balances." />
      </div>
    </section>
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
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Expenses</h2>
        <span className="text-sm font-medium">{formatMoney(e.total)} · {e.count} entries</span>
      </div>
      {e.byCategory.length ? (
        <GlassCard className="space-y-2 p-5">
          {e.byCategory.map((c) => (
            <div key={c.category} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{categoryLabel(c.category)}</span>
              <span className="font-medium tabular-nums">{formatMoney(c.total)}</span>
            </div>
          ))}
        </GlassCard>
      ) : null}
      {e.list.length ? (
        <DataTable columns={listCols} data={e.list} searchPlaceholder="Search…" pageSize={8} emptyMessage="No expenses." />
      ) : (
        <GlassCard className="p-5 text-sm text-muted-foreground">No expenses in this period.</GlassCard>
      )}
    </section>
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
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Roster · {data.roster.headcount} staff</h2>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(data.roster.byRole).map(([r, n]) => (
            <StatusBadge key={r} tone="neutral" dot={false}>
              {prettyRole(r)}: {n}
            </StatusBadge>
          ))}
        </div>
      </div>
      <DataTable columns={cols} data={data.roster.members} searchPlaceholder="Search staff…" pageSize={8} emptyMessage="No members." />
    </section>
  );
}

function DuesSection({ data }) {
  const d = data.dues;
  const cols = [
    { id: 'name', header: 'Person', accessorFn: (r) => `${r.name} ${r.employeeId} ${roleName(r)}`, cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: 'id', header: 'ID', accessorFn: (r) => r.employeeId, cell: ({ row }) => <span className="text-sm tabular-nums text-muted-foreground">{row.original.employeeId}</span> },
    { id: 'role', header: 'Role', accessorFn: (r) => roleName(r), cell: ({ row }) => <StatusBadge tone="primary" dot={false}>{roleName(row.original)}</StatusBadge> },
    { id: 'pending', header: 'Pending', accessorFn: (r) => r.pending ?? 0, cell: ({ row }) => <span className="font-medium tabular-nums text-destructive">{row.original.pending ? formatMoney(row.original.pending) : '—'}</span> },
    { id: 'advance', header: 'Advance', accessorFn: (r) => r.advance ?? 0, cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.advance ? formatMoney(row.original.advance) : '—'}</span> },
  ];
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Dues</h2>
        <span className="text-sm text-muted-foreground">
          {formatMoney(d.totalPending)} pending · {d.owingCount} owing · {formatMoney(d.totalAdvance)} advance
        </span>
      </div>
      {d.people.length ? (
        <DataTable columns={cols} data={d.people} searchPlaceholder="Search people…" pageSize={8} emptyMessage="No dues." />
      ) : (
        <GlassCard className="p-5 text-sm text-muted-foreground">No outstanding dues.</GlassCard>
      )}
    </section>
  );
}

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

export function ReportPreview({ data, sections }) {
  // Warm the role-label cache so the roster's per-role count chips (bare keys)
  // render edited names, and re-render once labels arrive.
  useRoleOptions();
  const has = (s) => sections.includes(s);
  return (
    <div className="space-y-10">
      <OngoingNotice data={data} workingDays={data.workingDays} />
      {has('attendance') && data.attendance ? <AttendanceSection data={data} /> : null}
      {has('leaves') && data.leaves ? <LeavesSection data={data} /> : null}
      {has('expenses') && data.expenses ? <ExpensesSection data={data} /> : null}
      {has('roster') && data.roster ? <RosterSection data={data} /> : null}
      {has('dues') && data.dues ? <DuesSection data={data} /> : null}
    </div>
  );
}
