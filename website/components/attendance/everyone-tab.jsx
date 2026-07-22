'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Clock, Download, Pencil, TriangleAlert, UserCheck, UserPlus, Users, UserX } from 'lucide-react';
import { api, getAuthToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, roleName } from '@/lib/permissions';
import { effectiveStatus } from '@/lib/attendance';
import { DatePicker } from '@/components/ui/date-picker';
import { TimePicker } from '@/components/ui/time-picker';
import { APP_LIVE_YMD } from '@/lib/app-live';
import { formatYMD } from '@/lib/leave';
import { AttendanceStatusBadge, attendanceStatusText } from './attendance-status-badge';
import { DataTable } from '@/components/glass/data-table';
import { StatCard } from '@/components/glass/stat-card';
import { TableSkeleton } from '@/components/glass/skeletons';
import { AppDialog } from '@/components/glass/app-dialog';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatTime, formatDuration, todayYMD } from '@/lib/time';
import { LEAVE_TYPES } from '@/lib/leave';

const columns = [
  {
    id: 'employee',
    header: 'Employee',
    // Search matches everything the cell displays (name, ID, department).
    accessorFn: (r) => `${r.user.name} ${r.user.employeeId} ${r.user.department || ''}`,
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
    // Editable label so searching/sorting matches what's displayed ("Nucleus Team", not TEAM).
    accessorFn: (r) => roleName(r.user),
    cell: ({ row }) => <span className="text-sm text-muted-foreground">{roleName(row.original.user)}</span>,
  },
  { id: 'in', header: 'In', accessorFn: (r) => r.attendance?.checkInAt ?? '', cell: ({ row }) => formatTime(row.original.attendance?.checkInAt) },
  { id: 'out', header: 'Out', accessorFn: (r) => r.attendance?.checkOutAt ?? '', cell: ({ row }) => formatTime(row.original.attendance?.checkOutAt) },
  { id: 'worked', header: 'Worked', accessorFn: (r) => r.attendance?.workedMinutes ?? -1, cell: ({ row }) => formatDuration(row.original.attendance?.workedMinutes) },
  {
    id: 'overtime',
    header: 'Overtime',
    accessorFn: (r) => r.attendance?.overtimeMinutes ?? -1,
    cell: ({ row }) => {
      const ot = row.original.attendance?.overtimeMinutes;
      return ot ? (
        <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-300">+{formatDuration(ot)}</span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      );
    },
  },
  {
    id: 'status',
    header: 'Status',
    accessorFn: (r) => attendanceStatusText(r.attendance, r.status),
    cell: ({ row }) => <AttendanceStatusBadge attendance={row.original.attendance} fallback={row.original.status} />,
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

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Authenticated CSV download (day roster or month payroll matrix). */
async function downloadCsv(path, filename) {
  const res = await fetch(`${API_BASE}/api${path}`, { headers: { Authorization: `Bearer ${getAuthToken()}` } });
  if (!res.ok) throw new Error('Could not download');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** A stat card that also acts as a filter toggle for the roster below. */
function FilterStat({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="w-full rounded-2xl text-left transition focus:outline-none">
      {children}
    </button>
  );
}

export function EveryoneTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canExcuse = !!user && can(user, 'approveRegularization');
  const [date, setDate] = React.useState(todayYMD());
  const [selected, setSelected] = React.useState(null);
  const [statusFilter, setStatusFilter] = React.useState(null); // null | 'present' | 'late' | 'absent'
  const [exporting, setExporting] = React.useState(''); // '' | 'day' | 'month'

  const exportDay = async () => {
    setExporting('day');
    try {
      await downloadCsv(`/attendance/export.csv?all=true&from=${date}&to=${date}`, `attendance-${date}.csv`);
      toast.success('Day sheet downloaded');
    } catch (e) {
      toast.error(e?.message || 'Could not download');
    } finally {
      setExporting('');
    }
  };

  const exportMonth = async () => {
    const month = date.slice(0, 7);
    setExporting('month');
    try {
      await downloadCsv(`/attendance/matrix.csv?month=${month}`, `attendance-${month}.csv`);
      toast.success('Month sheet downloaded');
    } catch (e) {
      toast.error(e?.message || 'Could not download');
    } finally {
      setExporting('');
    }
  };

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

  // Leadership: edit a person's day — set times, mark on leave, or clear.
  const [editing, setEditing] = React.useState(false);
  const [editMode, setEditMode] = React.useState('present'); // 'present' | 'leave' | 'absent'
  const [editIn, setEditIn] = React.useState('');
  const [editOut, setEditOut] = React.useState('');
  const [leaveType, setLeaveType] = React.useState('CASUAL');
  const hhmm = (iso) => (iso ? formatTime(iso) : ''); // 24h HH:mm for the time input

  React.useEffect(() => {
    setEditing(false);
    setEditMode(selected?.attendance?.checkInAt ? 'present' : 'present');
    setEditIn(hhmm(selected?.attendance?.checkInAt));
    setEditOut(hhmm(selected?.attendance?.checkOutAt));
    setLeaveType('CASUAL');
  }, [selected]);

  const editDate = data?.date ?? date;

  const saveEditMut = useMutation({
    mutationFn: () => {
      if (editMode === 'leave') {
        return api.post('/leaves/record', {
          userId: selected.user.id,
          startYMD: editDate,
          endYMD: editDate,
          type: leaveType,
        });
      }
      return api.put('/attendance/record', {
        userId: selected.user.id,
        dateYMD: editDate,
        checkIn: editMode === 'present' ? editIn || '' : '',
        checkOut: editMode === 'present' ? editOut || '' : '',
      });
    },
    onSuccess: () => {
      toast.success(editMode === 'leave' ? 'Marked on leave' : editMode === 'absent' ? 'Marked absent' : 'Attendance updated');
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['leaves'] });
      setEditing(false); // reset BEFORE closing so the footer doesn't deref a null row
      setSelected(null);
    },
    onError: (e) => toast.error(e?.message || 'Could not update'),
  });

  const rows = React.useMemo(() => data?.rows ?? [], [data]);
  const summary = data?.summary;
  // People who hadn't joined on this date aren't in the roster at all — say so, so a
  // short list reads as "they weren't here yet" rather than looking like missing data.
  const joinedLater = data?.joinedLater ?? [];
  const unexcusedLate = Math.max(0, (summary?.late ?? 0) - (summary?.excused ?? 0));
  const totalOvertime = React.useMemo(
    () => rows.reduce((sum, r) => sum + (r.attendance?.overtimeMinutes || 0), 0),
    [rows],
  );

  const toggleFilter = (key) => setStatusFilter((f) => (f === key ? null : key));
  const filteredRows = React.useMemo(() => {
    if (!statusFilter) return rows;
    return rows.filter((r) => {
      if (statusFilter === 'present') return r.status === 'PRESENT' || r.status === 'LATE'; // everyone who showed up
      if (statusFilter === 'late') return r.status === 'LATE' && !r.attendance?.excused; // excused = on-duty, not late
      if (statusFilter === 'absent') return r.status === 'ABSENT';
      return true;
    });
  }, [rows, statusFilter]);

  const sel = selected;
  const a = sel?.attendance;
  const selStatus = sel ? effectiveStatus(a, sel.status) : null;
  const isLateRow = !!a && a.status === 'LATE';
  const cat = a?.lateReason?.category;
  const note = a?.lateReason?.note;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-5">
        <FilterStat onClick={() => setStatusFilter(null)}>
          <StatCard label="Total staff" value={summary?.total ?? '—'} icon={Users} className="h-full" />
        </FilterStat>
        <FilterStat onClick={() => toggleFilter('present')}>
          <StatCard
            label="Present"
            value={(summary?.present ?? 0) + (summary?.late ?? 0)}
            icon={UserCheck}
            tone="success"
            className={cn('h-full', statusFilter === 'present' && 'ring-2 ring-primary')}
          />
        </FilterStat>
        <FilterStat onClick={() => toggleFilter('late')}>
          <StatCard
            label={summary?.excused ? `Late (${summary.excused} on-duty)` : 'Late'}
            value={unexcusedLate}
            icon={TriangleAlert}
            tone="warning"
            className={cn('h-full', statusFilter === 'late' && 'ring-2 ring-primary')}
          />
        </FilterStat>
        <FilterStat onClick={() => toggleFilter('absent')}>
          <StatCard
            label="Absent"
            value={summary?.absent ?? 0}
            icon={UserX}
            tone="destructive"
            className={cn('h-full', statusFilter === 'absent' && 'ring-2 ring-primary')}
          />
        </FilterStat>
        <StatCard
          label="Total overtime"
          value={totalOvertime ? formatDuration(totalOvertime) : '0m'}
          icon={Clock}
          tone="success"
          className="col-span-2 h-full sm:col-span-1"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          Everyone · {new Date(`${data?.date ?? date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </h3>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Label htmlFor="ov-date" className="text-sm text-muted-foreground">
            Date
          </Label>
          <DatePicker
            id="ov-date"
            value={date}
            min={APP_LIVE_YMD}
            max={todayYMD()}
            onChange={(v) => setDate(v || todayYMD())}
            className="w-full bg-background/50 sm:w-44"
          />
          <div className="flex w-full gap-2 sm:w-auto">
            <Button variant="outline" onClick={exportDay} disabled={!!exporting} className="h-10 flex-1 sm:h-8 sm:flex-none">
              <Download className="size-4" /> {exporting === 'day' ? '…' : 'Day CSV'}
            </Button>
            <Button variant="outline" onClick={exportMonth} disabled={!!exporting} className="h-10 flex-1 sm:h-8 sm:flex-none">
              <Download className="size-4" /> {exporting === 'month' ? '…' : 'Month sheet'}
            </Button>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Tip: tap a card to filter{statusFilter ? ` (showing ${statusFilter})` : ''}, tap a row for full details{canExcuse ? ' or to excuse a late' : ''}.
      </p>

      {joinedLater.length ? (
        <div className="flex items-start gap-2 rounded-xl bg-foreground/[0.03] p-3 text-xs text-muted-foreground ring-1 ring-border/50">
          <UserPlus className="mt-0.5 size-3.5 shrink-0" />
          <p>
            <span className="font-medium text-foreground">
              {joinedLater.length} {joinedLater.length > 1 ? 'people are' : 'person is'} not listed
            </span>{' '}
            — they hadn&apos;t joined on this date:{' '}
            {joinedLater.map((p) => `${p.name} (joined ${formatYMD(p.joinedYMD)})`).join(', ')}.
          </p>
        </div>
      ) : null}

      {isLoading ? (
        <TableSkeleton rows={6} cols={8} />
      ) : (
        <DataTable
          columns={columns}
          data={filteredRows}
          searchPlaceholder="Search staff…"
          pageSize={10}
          emptyMessage={statusFilter ? `No ${statusFilter} staff for this day.` : 'No staff found.'}
          onRowClick={setSelected}
        />
      )}

      <AppDialog
        open={!!sel}
        onOpenChange={(o) => (!o ? setSelected(null) : null)}
        title={sel?.user?.name}
        description={
          sel ? `${sel.user.employeeId} · ${roleName(sel.user)}${sel.user.department ? ` · ${sel.user.department}` : ''}` : undefined
        }
        footer={
          canExcuse ? (
            editing ? (
              <div className="flex w-full flex-wrap items-center justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(false)} disabled={saveEditMut.isPending}>
                  Cancel
                </Button>
                {sel?.status !== 'ON_LEAVE' ? (
                  <Button onClick={() => saveEditMut.mutate()} disabled={saveEditMut.isPending}>
                    {saveEditMut.isPending ? 'Saving…' : 'Save'}
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" /> Edit times
                </Button>
                <div className="flex flex-wrap items-center gap-2">
                  {isLateRow ? (
                    <Button
                      variant={a?.excused ? 'outline' : 'default'}
                      disabled={excuseMut.isPending}
                      onClick={() => excuseMut.mutate({ id: a.id, excused: !a.excused })}
                    >
                      {excuseMut.isPending ? 'Saving…' : a?.excused ? 'Remove excuse' : 'Excuse (on-duty)'}
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
                </div>
              </div>
            )
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
              {selStatus ? <AttendanceStatusBadge attendance={a} fallback={sel.status} /> : null}
              <span className="text-xs text-muted-foreground">{data?.date ?? date}</span>
            </div>

            {canExcuse && editing ? (
              sel.status === 'ON_LEAVE' ? (
                <div className="rounded-xl bg-foreground/[0.04] p-3 text-sm text-muted-foreground ring-1 ring-border/50">
                  This day is on leave. To change it, cancel the leave from the <span className="font-medium text-foreground">Leaves</span> page first.
                </div>
              ) : (
                <div className="space-y-3 rounded-xl bg-primary/[0.05] p-3 ring-1 ring-primary/15">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Edit · {editDate}</p>
                  {/* Present (times) / On leave (type) / Absent (clear) */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { v: 'present', label: 'Present' },
                      { v: 'leave', label: 'On leave' },
                      { v: 'absent', label: 'Absent' },
                    ].map((o) => (
                      <button
                        key={o.v}
                        type="button"
                        onClick={() => setEditMode(o.v)}
                        className={cn(
                          'rounded-lg px-2 py-2 text-sm font-medium ring-1 transition-colors',
                          editMode === o.v
                            ? 'bg-primary text-primary-foreground ring-primary'
                            : 'bg-background/50 text-muted-foreground ring-border hover:text-foreground',
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>

                  {editMode === 'present' ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="ed-in">Check-in</Label>
                          <TimePicker id="ed-in" value={editIn} onChange={setEditIn} className="bg-background/50" />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="ed-out">Check-out</Label>
                          <TimePicker id="ed-out" value={editOut} onChange={setEditOut} className="bg-background/50" />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">Late/overtime recompute automatically from their schedule.</p>
                    </>
                  ) : null}

                  {editMode === 'leave' ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="ed-leave">Leave type</Label>
                      <Select value={leaveType} onValueChange={setLeaveType}>
                        <SelectTrigger id="ed-leave" className="w-full bg-background/50">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LEAVE_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Creates an approved leave for this day and deducts their balance (paid types).</p>
                    </div>
                  ) : null}

                  {editMode === 'absent' ? (
                    <p className="text-xs text-muted-foreground">Clears any check-in/out for this day — the person shows as absent.</p>
                  ) : null}
                </div>
              )
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <Field label="Check-in" value={formatTime(a?.checkInAt)} />
                <Field label="Check-out" value={formatTime(a?.checkOutAt)} />
                <Field label="Worked" value={formatDuration(a?.workedMinutes)} />
                <Field label="Overtime" value={a?.overtimeMinutes ? `+${formatDuration(a.overtimeMinutes)}` : '—'} />
              </div>
            )}

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
