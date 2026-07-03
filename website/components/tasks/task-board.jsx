'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CheckCircle2, ClipboardList, Download, FolderOpen, ListTodo, Pencil, Search, Trash2, Undo2, UserRound, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/glass/empty-state';
import { StatusBadge } from '@/components/glass/status-badge';
import { LoadingState } from '@/components/glass/skeletons';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { TaskDialog } from './task-dialog';
import { AssignDialog } from './assign-dialog';
import { PDF_SCOPES, downloadTasksPdf, isOverdue } from '@/lib/task';

const PERIODS = [
  { value: 'all', label: 'All Time' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'year', label: 'Last year' },
];
const PERIOD_LABELS = Object.fromEntries(PERIODS.map((p) => [p.value, p.label]));
const PDF_LABELS = Object.fromEntries(PDF_SCOPES.map((s) => [s.value, s.label]));

const STAT_TONE = {
  warning: 'bg-warning/15 text-amber-600 ring-warning/25 dark:text-amber-300',
  success: 'bg-success/12 text-success ring-success/25',
  default: 'bg-primary/12 text-primary ring-primary/20',
};

/** Compact stat that fits three-across on a phone with a clearly visible icon. */
function StatMini({ label, value, icon: Icon, tone = 'default' }) {
  return (
    <div className="glass glass-highlight rounded-2xl p-3 text-center sm:p-4">
      <span className={cn('mx-auto flex size-9 items-center justify-center rounded-xl ring-1', STAT_TONE[tone])}>
        <Icon className="size-[18px]" />
      </span>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function initials(name = '') {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?'
  );
}

function fmtDate(d) {
  if (!d) return '';
  const isYMD = String(d).length <= 10;
  // Datetimes (e.g. completedAt) are pinned to the company timezone so the day never shifts.
  return new Date(isYMD ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(isYMD ? {} : { timeZone: 'Asia/Kolkata' }),
  });
}

/** Earliest due date first; undated work sinks to the bottom (newest of those first). */
function byDueDate(a, b) {
  if (a.dueYMD && b.dueYMD && a.dueYMD !== b.dueYMD) return a.dueYMD < b.dueYMD ? -1 : 1;
  if (a.dueYMD && !b.dueYMD) return -1;
  if (!a.dueYMD && b.dueYMD) return 1;
  return new Date(b.createdAt) - new Date(a.createdAt);
}

/** Personal / history task row — tap the row for full details, the circle to complete. */
function TaskRow({ task, canToggle, onToggle, onEdit, onDelete, onOpen }) {
  const done = task.status === 'DONE';
  const overdue = !done && isOverdue(task.dueYMD);
  return (
    <div
      onClick={() => onOpen(task)}
      className="flex cursor-pointer items-start gap-3 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50 transition-colors hover:bg-foreground/[0.06]"
    >
      {/* 40px touch target; the visual 20px circle sits inside (negative margins keep layout). */}
      <button
        type="button"
        disabled={!canToggle}
        onClick={(e) => {
          e.stopPropagation();
          if (canToggle) onToggle(task);
        }}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        className={cn('group/tgl -m-2.5 -mt-2 flex size-10 shrink-0 items-center justify-center', !canToggle && 'cursor-default')}
      >
        <span
          className={cn(
            'flex size-5 items-center justify-center rounded-full ring-1 transition-colors',
            done ? 'bg-success text-white ring-success' : 'ring-border',
            canToggle && !done && 'group-hover/tgl:ring-primary',
            !canToggle && 'opacity-70',
          )}
        >
          {done ? <Check className="size-3.5" /> : null}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('font-medium leading-snug', done && 'text-muted-foreground line-through')}>{task.title}</p>
        {task.notes ? <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">{task.notes}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {!task.assignedBy ? null : (
            <span>
              From: <span className="font-medium text-foreground">{task.assignedBy.name}</span>
            </span>
          )}
          {task.dueYMD ? <span className={cn(overdue && 'font-medium text-destructive')}>Due {fmtDate(task.dueYMD)}</span> : null}
          {done && task.completedAt ? <span className="text-success">Done {fmtDate(task.completedAt)}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        {/* A delegated task belongs to the assigner: the assignee can only complete
            it — not edit or delete. Both actions show only on personal tasks. */}
        {task.assignedBy ? null : (
          <>
            <Button variant="ghost" size="icon" className="size-10 sm:size-8" onClick={(e) => { e.stopPropagation(); onEdit(task); }} aria-label="Edit">
              <Pencil className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-10 text-destructive sm:size-8" onClick={(e) => { e.stopPropagation(); onDelete(task); }} aria-label="Delete">
              <Trash2 className="size-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** A date-grouped list of a person's tasks (inside the folder dialog). */
function DatedTaskList({ tasks, dateKey, ascending = false, onEdit, onDelete, onOpen, onToggle, canToggle = false, allowEdit = () => true, allowDelete = () => true }) {
  const groups = React.useMemo(() => {
    const map = new Map();
    for (const t of tasks) {
      const raw = dateKey(t);
      const key = raw ? String(raw).slice(0, 10) : '';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    }
    // Sort dates (ascending = earliest due first for pending work); "no date" bucket last.
    return [...map.entries()]
      .sort((a, b) => {
        if (a[0] && b[0]) {
          if (a[0] === b[0]) return 0;
          const earlier = a[0] < b[0] ? -1 : 1;
          return ascending ? earlier : -earlier;
        }
        return a[0] ? -1 : 1;
      })
      .map(([date, items]) => ({ date, items }));
  }, [tasks, dateKey, ascending]);

  if (!tasks.length) return <p className="px-1 py-3 text-sm text-muted-foreground">Nothing here.</p>;

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.date || 'none'} className="space-y-1.5">
          <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.date ? fmtDate(g.date) : 'No date'}</p>
          {g.items.map((t) => {
            const done = t.status === 'DONE';
            const overdue = !done && isOverdue(t.dueYMD);
            return (
              <div
                key={t.id}
                onClick={() => onOpen(t)}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-foreground/[0.03] p-2.5 ring-1 ring-border/50 transition-colors hover:bg-foreground/[0.06]"
              >
                {canToggle ? (
                  /* 40px touch target on mobile; the visual 20px circle sits inside. */
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle?.(t);
                    }}
                    aria-label={done ? 'Mark as not done' : 'Mark as done'}
                    className="group/tgl -m-1.5 flex size-10 shrink-0 items-center justify-center sm:size-8"
                  >
                    <span
                      className={cn(
                        'flex size-5 items-center justify-center rounded-full ring-1 transition-colors',
                        done ? 'bg-success text-white ring-success' : 'ring-border group-hover/tgl:ring-primary',
                      )}
                    >
                      {done ? <Check className="size-3.5" /> : null}
                    </span>
                  </button>
                ) : (
                  <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', done ? 'bg-success' : 'bg-warning')} />
                )}
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium', done && 'text-muted-foreground line-through')}>{t.title}</p>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {t.dueYMD ? <span className={cn(overdue && 'font-medium text-destructive')}>Due {fmtDate(t.dueYMD)}</span> : null}
                    {done && t.completedAt ? <span className="text-success">Done {fmtDate(t.completedAt)}</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center">
                  {allowEdit(t) ? (
                    <Button variant="ghost" size="icon" className="size-10 sm:size-7" onClick={(e) => { e.stopPropagation(); onEdit(t); }} aria-label="Edit">
                      <Pencil className="size-3.5" />
                    </Button>
                  ) : null}
                  {allowDelete(t) ? (
                    <Button variant="ghost" size="icon" className="size-10 text-destructive sm:size-7" onClick={(e) => { e.stopPropagation(); onDelete(t); }} aria-label="Delete">
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A person "folder": name, progress, and (on click) their pending/completed tasks date-wise. */
function PersonFolder({ folder, onEdit, onDelete, onOpen, onToggle, canToggle = false, allowEdit = () => true, allowDelete = () => true }) {
  const [open, setOpen] = React.useState(false);
  const pct = folder.total ? Math.round((folder.done / folder.total) * 100) : 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl bg-foreground/[0.03] p-4 text-left ring-1 ring-border/50 transition-colors hover:bg-foreground/[0.06]"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary ring-1 ring-primary/15">
          {initials(folder.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{folder.name}</p>
          <p className="text-xs text-muted-foreground">
            {folder.pending} pending · {folder.done} done
          </p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
      </button>

      <AppDialog
        open={open}
        onOpenChange={setOpen}
        title={folder.name}
        description={`${folder.pending} pending · ${folder.done} completed · ${folder.total} total`}
        footer={
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="max-h-[65vh] space-y-5 overflow-y-auto py-1">
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ListTodo className="size-4 text-warning" /> Pending ({folder.pending})
            </h3>
            <DatedTaskList tasks={folder.pendingTasks} dateKey={(t) => t.dueYMD || t.createdAt} ascending onEdit={onEdit} onDelete={onDelete} onOpen={onOpen} onToggle={onToggle} canToggle={canToggle} allowEdit={allowEdit} allowDelete={allowDelete} />
          </section>
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="size-4 text-success" /> Completed ({folder.done})
            </h3>
            <DatedTaskList tasks={folder.doneTasks} dateKey={(t) => t.completedAt || t.createdAt} onEdit={onEdit} onDelete={onDelete} onOpen={onOpen} onToggle={onToggle} canToggle={canToggle} allowEdit={allowEdit} allowDelete={allowDelete} />
          </section>
        </div>
      </AppDialog>
    </>
  );
}

/** Full task details — opened by tapping any task row. */
function TaskDetailDialog({ view, onClose, onToggle, onEdit, onDelete }) {
  const task = view?.task;
  const done = task?.status === 'DONE';
  const overdue = task && !done && isOverdue(task.dueYMD);

  const Row = ({ label, children }) => (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm font-medium">{children}</span>
    </div>
  );

  return (
    <AppDialog
      open={!!view}
      onOpenChange={(o) => (!o ? onClose() : null)}
      title="Task details"
      footer={
        task ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {view.allowEdit ? (
                <Button variant="outline" onClick={() => onEdit(task)}>
                  <Pencil className="size-4" /> Edit
                </Button>
              ) : null}
              {view.allowDelete ? (
                <Button variant="ghost" className="text-destructive" onClick={() => onDelete(task)}>
                  <Trash2 className="size-4" /> Delete
                </Button>
              ) : null}
            </div>
            {view.canToggle ? (
              <Button variant={done ? 'outline' : 'default'} onClick={() => onToggle(task)}>
                {done ? (
                  <>
                    <Undo2 className="size-4" /> Mark not done
                  </>
                ) : (
                  <>
                    <Check className="size-4" /> Mark as done
                  </>
                )}
              </Button>
            ) : (
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        ) : null
      }
    >
      {task ? (
        <div className="space-y-4 py-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={done ? 'success' : 'warning'}>{done ? 'Done' : 'Pending'}</StatusBadge>
            {overdue ? <StatusBadge tone="destructive">Overdue</StatusBadge> : null}
          </div>

          <div>
            <p className={cn('text-lg font-semibold leading-snug break-words', done && 'text-muted-foreground line-through')}>{task.title}</p>
            {task.notes ? (
              <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-foreground/[0.04] p-3 text-sm text-muted-foreground ring-1 ring-border/50">
                {task.notes}
              </p>
            ) : null}
          </div>

          <div className="divide-y divide-border/50 rounded-xl bg-foreground/[0.03] px-3 ring-1 ring-border/50">
            <Row label="Type">
              {task.assignedBy?.name ? (
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="size-3.5 text-primary" /> Assigned by {task.assignedBy.name}
                </span>
              ) : task.owner?.name && view.assignerView ? (
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="size-3.5 text-primary" /> Assigned to {task.owner.name}
                </span>
              ) : (
                'Personal task'
              )}
            </Row>
            <Row label="Due date">{task.dueYMD ? fmtDate(task.dueYMD) : '—'}</Row>
            <Row label="Created">{fmtDate(task.createdAt)}</Row>
            {done ? <Row label="Completed">{task.completedAt ? fmtDate(task.completedAt) : '—'}</Row> : null}
          </div>
        </div>
      ) : null}
    </AppDialog>
  );
}

export function TaskBoard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  // Per-person delegation access — set by leadership in Users → Edit.
  const ta = user?.taskAssign || {};
  const canAssign = ta.mode === 'ALL' || (ta.mode === 'SELECTED' && (ta.users || []).length > 0);

  // Honour deep links like /todo?tab=assigned (used by task notifications).
  const params = useSearchParams();
  const requestedTab = params.get('tab');
  const [tab, setTab] = React.useState(() =>
    ['mine', 'history', 'assigned'].includes(requestedTab) ? requestedTab : 'mine',
  );
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');

  // Debounce the server-side task search so typing doesn't refetch per keystroke.
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [period, setPeriod] = React.useState('all');
  const [pdfScope, setPdfScope] = React.useState('all');
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const [deleting, setDeleting] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const [viewing, setViewing] = React.useState(null); // { task, canToggle, allowDelete, assignerView }

  const isAssigned = tab === 'assigned';

  // Reset the search box when switching tabs (task-text vs person name).
  React.useEffect(() => setSearch(''), [tab]);

  const { data: sum } = useQuery({ queryKey: ['tasks', 'summary'], queryFn: () => api.get('/tasks/summary') });
  const m = sum?.mine ?? { pending: 0, done: 0, total: 0 };

  const isMine = tab === 'mine';
  const scope = isAssigned ? 'assigned' : 'mine';
  // History fetches completed only. My tasks fetches ALL statuses (folders need
  // pending AND completed together) and splits/groups client-side.
  const status = tab === 'history' ? 'DONE' : '';

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', 'list', scope, status, isMine || isAssigned ? '' : debouncedSearch, isMine ? 'all' : period],
    queryFn: () => {
      const p = new URLSearchParams({ scope, limit: '10000' });
      if (status) p.set('status', status);
      // My tasks & Assigned search client-side (task text + person name); History uses the server.
      if (!isMine && !isAssigned && debouncedSearch) p.set('search', debouncedSearch);
      // My tasks always shows each assigner's full history, so no period trimming there.
      if (period && period !== 'all' && !isMine) p.set('period', period);
      return api.get(`/tasks?${p.toString()}`);
    },
    placeholderData: (prev) => prev, // keep rows visible while a new search loads
  });
  const tasks = React.useMemo(() => data?.tasks ?? [], [data]);

  // My-tasks view: a flat list of personal pending work (nearest-due-first) plus,
  // when 2+ people have delegated work to me, one folder per assigner. A lone
  // assigner's pending tasks fold into the flat list (no folder tap for one person).
  const mine = React.useMemo(() => {
    if (!isMine) return { personalPending: [], folders: [] };
    const q = search.toLowerCase().trim();
    const textHit = (t) => t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q);
    // A flat row matches on its own text OR the name of whoever assigned it.
    const matchesRow = (t) => !q || textHit(t) || (t.assignedBy?.name || '').toLowerCase().includes(q);

    const byAssigner = new Map();
    const personal = [];
    for (const t of tasks) {
      if (t.assignedBy) {
        const id = t.assignedBy.id || String(t.assignedBy);
        if (!byAssigner.has(id)) byAssigner.set(id, { id, name: t.assignedBy.name || 'Unknown', tasks: [] });
        byAssigner.get(id).tasks.push(t);
      } else if (t.status !== 'DONE') {
        personal.push(t); // completed personal tasks live in History, not here
      }
    }

    // A person only anchors a folder while they have PENDING work for me. Once it's
    // all done, that relationship lives in History — not this pending-focused view.
    const active = [...byAssigner.values()].filter((f) => f.tasks.some((t) => t.status !== 'DONE'));

    let personalPending = personal;
    let folders = [];

    if (active.length >= 2) {
      folders = active
        .map((f) => {
          const pendingTasks = f.tasks.filter((t) => t.status !== 'DONE');
          const doneTasks = f.tasks.filter((t) => t.status === 'DONE');
          const nextDue = pendingTasks.map((t) => t.dueYMD).filter(Boolean).sort()[0] || '';
          return { ...f, pendingTasks, doneTasks, pending: pendingTasks.length, done: doneTasks.length, total: f.tasks.length, nextDue };
        })
        // A folder is a person — search it by name (task text filters the flat list).
        .filter((f) => !q || f.name.toLowerCase().includes(q))
        // Soonest deadline first, then most pending, then name (deterministic).
        .sort((a, b) => {
          if (a.nextDue && b.nextDue && a.nextDue !== b.nextDue) return a.nextDue < b.nextDue ? -1 : 1;
          if (a.nextDue && !b.nextDue) return -1;
          if (!a.nextDue && b.nextDue) return 1;
          return b.pending - a.pending || a.name.localeCompare(b.name);
        });
    } else if (active.length === 1) {
      personalPending = [...personal, ...active[0].tasks.filter((t) => t.status !== 'DONE')];
    }

    personalPending = personalPending.filter(matchesRow).sort(byDueDate);
    return { personalPending, folders };
  }, [isMine, tasks, search]);

  // Group assigned tasks into per-person folders (filtered by the name search).
  const folders = React.useMemo(() => {
    if (!isAssigned) return [];
    const byOwner = new Map();
    for (const t of tasks) {
      const id = t.owner?.id || String(t.owner);
      if (!byOwner.has(id)) byOwner.set(id, { id, name: t.owner?.name || 'Unknown', tasks: [] });
      byOwner.get(id).tasks.push(t);
    }
    const q = search.toLowerCase().trim();
    return [...byOwner.values()]
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .map((f) => {
        const pendingTasks = f.tasks.filter((t) => t.status !== 'DONE');
        const doneTasks = f.tasks.filter((t) => t.status === 'DONE');
        return { ...f, pendingTasks, doneTasks, pending: pendingTasks.length, done: doneTasks.length, total: f.tasks.length };
      })
      .sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));
  }, [isAssigned, tasks, search]);

  const toggleMut = useMutation({
    mutationFn: (t) => api.patch(`/tasks/${t.id}/status`, { status: t.status === 'DONE' ? 'PENDING' : 'DONE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (e) => toast.error(e?.message || 'Could not update the task'),
  });

  const delMut = useMutation({
    mutationFn: (id) => api.delete(`/tasks/${id}`),
    onSuccess: () => {
      toast.success('Task removed');
      qc.invalidateQueries({ queryKey: ['tasks'] });
      setDeleting(null);
    },
    onError: (e) => toast.error(e?.message || 'Could not delete'),
  });

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      await downloadTasksPdf(pdfScope, scope);
    } catch (e) {
      toast.error(e?.message || 'Could not download');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatMini label="Pending" value={m.pending} icon={ListTodo} tone={m.pending ? 'warning' : 'default'} />
        <StatMini label="Completed" value={m.done} icon={CheckCircle2} tone="success" />
        <StatMini label="Total" value={m.total} icon={ClipboardList} />
      </div>

      <div className="flex flex-wrap gap-2">
        <TaskDialog />
        {canAssign ? <AssignDialog /> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAssigned ? 'Search by person…' : isMine ? 'Search tasks or people…' : 'Search tasks…'}
            className="h-9 bg-background/50 pl-9"
          />
        </div>
        {/* My tasks always shows every assigner's full history, so the period filter doesn't apply there. */}
        {!isMine ? (
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-9 w-full bg-background/50 sm:w-36">
              <span className="line-clamp-1">{PERIOD_LABELS[period] ?? 'All Time'}</span>
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <Select value={pdfScope} onValueChange={setPdfScope}>
            <SelectTrigger className="h-9 flex-1 bg-background/50 sm:w-40">
              <span className="line-clamp-1">{PDF_LABELS[pdfScope] ?? 'All Work'}</span>
            </SelectTrigger>
            <SelectContent>
              {PDF_SCOPES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={downloadPdf} disabled={pdfBusy} className="shrink-0">
            <Download className="size-4" /> {pdfBusy ? '…' : 'PDF'}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="mine">My tasks</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          {canAssign ? <TabsTrigger value="assigned">Assigned by me</TabsTrigger> : null}
        </TabsList>
        <TabsContent value={tab} className="pt-4">
          {isLoading ? (
            <LoadingState label="Loading tasks…" />
          ) : isAssigned ? (
            folders.length ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {folders.map((f) => (
                  <PersonFolder
                    key={f.id}
                    folder={f}
                    onEdit={(x) => setEditing(x)}
                    onDelete={(x) => setDeleting(x)}
                    onOpen={(x) => setViewing({ task: x, canToggle: false, allowEdit: true, allowDelete: true, assignerView: true })}
                  />
                ))}
              </div>
            ) : (
              <EmptyState icon={Users} title={search ? 'No one matches that name' : 'You haven’t assigned any work'} description={search ? '' : 'Use “Assign work” to give a task to someone below you.'} />
            )
          ) : isMine ? (
            !mine.personalPending.length && !mine.folders.length ? (
              <EmptyState
                icon={ListTodo}
                title={search.trim() ? 'No matching tasks' : 'No pending tasks'}
                description={search.trim() ? '' : 'Add your first task above.'}
              />
            ) : (
              <div className="space-y-6">
                {mine.personalPending.length ? (
                  <div className="space-y-2.5">
                    {/* Heading only appears once there are folders below to distinguish the two. */}
                    {mine.folders.length ? (
                      <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <ListTodo className="size-4 text-warning" /> My tasks
                        <span className="font-normal text-muted-foreground">({mine.personalPending.length})</span>
                      </h3>
                    ) : null}
                    {mine.personalPending.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        canToggle
                        onToggle={(x) => toggleMut.mutate(x)}
                        onEdit={(x) => setEditing(x)}
                        onDelete={(x) => setDeleting(x)}
                        onOpen={(x) => setViewing({ task: x, canToggle: true, allowEdit: !x.assignedBy, allowDelete: !x.assignedBy, assignerView: false })}
                      />
                    ))}
                  </div>
                ) : null}

                {mine.folders.length ? (
                  <div className="space-y-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <UserRound className="size-4 text-primary" /> Assigned to me
                      <span className="font-normal text-muted-foreground">
                        ({mine.folders.reduce((n, f) => n + f.pending, 0)} pending)
                      </span>
                    </h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {mine.folders.map((f) => (
                        <PersonFolder
                          key={f.id}
                          folder={f}
                          canToggle
                          allowEdit={() => false}
                          allowDelete={() => false}
                          onToggle={(x) => toggleMut.mutate(x)}
                          onEdit={(x) => setEditing(x)}
                          onDelete={(x) => setDeleting(x)}
                          onOpen={(x) => setViewing({ task: x, canToggle: true, allowEdit: false, allowDelete: false, assignerView: false })}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {(data?.total ?? 0) > tasks.length ? (
                  <p className="px-1 text-xs text-muted-foreground">
                    Showing your most recent {tasks.length} tasks — some older ones are hidden.
                  </p>
                ) : null}
              </div>
            )
          ) : !tasks.length ? (
            <EmptyState icon={ListTodo} title="Nothing completed yet" description="" />
          ) : (
            <div className="space-y-2.5">
              {tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  canToggle
                  onToggle={(x) => toggleMut.mutate(x)}
                  onEdit={(x) => setEditing(x)}
                  onDelete={(x) => setDeleting(x)}
                  onOpen={(x) => setViewing({ task: x, canToggle: true, allowEdit: !x.assignedBy, allowDelete: !x.assignedBy, assignerView: false })}
                />
              ))}
              {(data?.total ?? 0) > tasks.length ? (
                <p className="px-1 text-xs text-muted-foreground">
                  Showing {tasks.length} of {data.total} — narrow the search to see the rest.
                </p>
              ) : null}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {editing ? (
        <TaskDialog task={editing} open={!!editing} onOpenChange={(o) => (!o ? setEditing(null) : null)} />
      ) : null}

      <TaskDetailDialog
        view={viewing}
        onClose={() => setViewing(null)}
        onToggle={(t) => {
          toggleMut.mutate(t);
          setViewing(null);
        }}
        onEdit={(t) => {
          setViewing(null);
          setEditing(t);
        }}
        onDelete={(t) => {
          setViewing(null);
          setDeleting(t);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => (!o ? setDeleting(null) : null)}
        title="Delete this task?"
        description={deleting ? `“${deleting.title}” will be removed.` : ''}
        tone="destructive"
        confirmLabel="Delete"
        loading={delMut.isPending}
        onConfirm={() => deleting && delMut.mutate(deleting.id)}
      />
    </div>
  );
}
