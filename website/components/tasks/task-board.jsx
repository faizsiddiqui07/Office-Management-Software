'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CheckCircle2, ClipboardList, Download, FolderOpen, ListTodo, Search, Trash2, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/glass/status-badge';
import { EmptyState } from '@/components/glass/empty-state';
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
  return new Date(String(d).length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Personal / history task row with a click-to-complete circle. */
function TaskRow({ task, canToggle, onToggle, onDelete }) {
  const done = task.status === 'DONE';
  const overdue = !done && isOverdue(task.dueYMD);
  return (
    <div className="flex items-start gap-3 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
      <button
        type="button"
        disabled={!canToggle}
        onClick={() => canToggle && onToggle(task)}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ring-1 transition-colors',
          done ? 'bg-success text-white ring-success' : 'ring-border hover:ring-primary',
          !canToggle && 'cursor-default opacity-70',
        )}
      >
        {done ? <Check className="size-3.5" /> : null}
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
      <Button variant="ghost" size="icon" className="shrink-0 text-destructive" onClick={() => onDelete(task)} aria-label="Delete">
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

/** A date-grouped list of a person's tasks (inside the folder dialog). */
function DatedTaskList({ tasks, dateKey, onDelete }) {
  const groups = React.useMemo(() => {
    const map = new Map();
    for (const t of tasks) {
      const raw = dateKey(t);
      const key = raw ? String(raw).slice(0, 10) : '';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    }
    // Sort dates: real dates descending, "no date" bucket last.
    return [...map.entries()]
      .sort((a, b) => (a[0] && b[0] ? (a[0] < b[0] ? 1 : -1) : a[0] ? -1 : 1))
      .map(([date, items]) => ({ date, items }));
  }, [tasks, dateKey]);

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
              <div key={t.id} className="flex items-start gap-2.5 rounded-lg bg-foreground/[0.03] p-2.5 ring-1 ring-border/50">
                <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', done ? 'bg-success' : 'bg-warning')} />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium', done && 'text-muted-foreground line-through')}>{t.title}</p>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {t.dueYMD ? <span className={cn(overdue && 'font-medium text-destructive')}>Due {fmtDate(t.dueYMD)}</span> : null}
                    {done && t.completedAt ? <span className="text-success">Done {fmtDate(t.completedAt)}</span> : null}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="size-7 shrink-0 text-destructive" onClick={() => onDelete(t)} aria-label="Delete">
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A person "folder": name, progress, and (on click) their pending/completed tasks date-wise. */
function PersonFolder({ folder, onDelete }) {
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
            <DatedTaskList tasks={folder.pendingTasks} dateKey={(t) => t.dueYMD || t.createdAt} onDelete={onDelete} />
          </section>
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="size-4 text-success" /> Completed ({folder.done})
            </h3>
            <DatedTaskList tasks={folder.doneTasks} dateKey={(t) => t.completedAt || t.createdAt} onDelete={onDelete} />
          </section>
        </div>
      </AppDialog>
    </>
  );
}

export function TaskBoard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canAssign = !!user && can(user, 'assignTasks');

  const [tab, setTab] = React.useState('mine');
  const [search, setSearch] = React.useState('');
  const [period, setPeriod] = React.useState('all');
  const [pdfScope, setPdfScope] = React.useState('all');
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const [deleting, setDeleting] = React.useState(null);

  const isAssigned = tab === 'assigned';

  // Reset the search box when switching tabs (task-text vs person name).
  React.useEffect(() => setSearch(''), [tab]);

  const { data: sum } = useQuery({ queryKey: ['tasks', 'summary'], queryFn: () => api.get('/tasks/summary') });
  const m = sum?.mine ?? { pending: 0, done: 0, total: 0 };

  const scope = isAssigned ? 'assigned' : 'mine';
  const status = tab === 'mine' ? 'PENDING' : tab === 'history' ? 'DONE' : '';

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', 'list', scope, status, isAssigned ? '' : search, period],
    queryFn: () => {
      const p = new URLSearchParams({ scope, limit: '1000' });
      if (status) p.set('status', status);
      if (!isAssigned && search) p.set('search', search); // assigned tab searches by person, client-side
      if (period && period !== 'all') p.set('period', period);
      return api.get(`/tasks?${p.toString()}`);
    },
  });
  const tasks = React.useMemo(() => data?.tasks ?? [], [data]);

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
            placeholder={isAssigned ? 'Search by person…' : 'Search tasks…'}
            className="h-9 bg-background/50 pl-9"
          />
        </div>
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
                  <PersonFolder key={f.id} folder={f} onDelete={(x) => setDeleting(x)} />
                ))}
              </div>
            ) : (
              <EmptyState icon={Users} title={search ? 'No one matches that name' : 'You haven’t assigned any work'} description={search ? '' : 'Use “Assign work” to give a task to someone below you.'} />
            )
          ) : !tasks.length ? (
            <EmptyState icon={ListTodo} title={tab === 'history' ? 'Nothing completed yet' : 'No pending tasks'} description={tab === 'mine' ? 'Add your first task above.' : ''} />
          ) : (
            <div className="space-y-2.5">
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} canToggle onToggle={(x) => toggleMut.mutate(x)} onDelete={(x) => setDeleting(x)} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

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
