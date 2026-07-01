'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CheckCircle2, ClipboardList, Download, ListTodo, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { StatCard } from '@/components/glass/stat-card';
import { StatusBadge } from '@/components/glass/status-badge';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TaskDialog } from './task-dialog';
import { AssignDialog } from './assign-dialog';
import { PDF_SCOPES, downloadTasksPdf, isOverdue } from '@/lib/task';

function TaskRow({ task, showOwner, canToggle, onToggle, onDelete }) {
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
          {showOwner && task.owner ? (
            <span>
              For: <span className="font-medium text-foreground">{task.owner.name}</span>
            </span>
          ) : null}
          {!showOwner && task.assignedBy ? (
            <span>
              From: <span className="font-medium text-foreground">{task.assignedBy.name}</span>
            </span>
          ) : null}
          {task.dueYMD ? <span className={cn(overdue && 'font-medium text-destructive')}>Due {task.dueYMD}</span> : null}
          {done && task.completedAt ? <span className="text-success">Done {String(task.completedAt).slice(0, 10)}</span> : null}
          {showOwner ? (
            <StatusBadge tone={done ? 'success' : 'warning'} dot={false}>
              {done ? 'Done' : 'Pending'}
            </StatusBadge>
          ) : null}
        </div>
      </div>
      <Button variant="ghost" size="icon" className="shrink-0 text-destructive" onClick={() => onDelete(task)} aria-label="Delete">
        <Trash2 className="size-4" />
      </Button>
    </div>
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

  const { data: sum } = useQuery({ queryKey: ['tasks', 'summary'], queryFn: () => api.get('/tasks/summary') });
  const m = sum?.mine ?? { pending: 0, done: 0, total: 0 };

  const scope = tab === 'assigned' ? 'assigned' : 'mine';
  const status = tab === 'mine' ? 'PENDING' : tab === 'history' ? 'DONE' : '';

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', 'list', scope, status, search, period],
    queryFn: () => {
      const p = new URLSearchParams({ scope, limit: '500' });
      if (status) p.set('status', status);
      if (search) p.set('search', search);
      if (period && period !== 'all') p.set('period', period);
      return api.get(`/tasks?${p.toString()}`);
    },
  });
  const tasks = data?.tasks ?? [];

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

  const emptyTitle = tab === 'history' ? 'Nothing completed yet' : tab === 'assigned' ? 'You haven’t assigned any work' : 'No pending tasks';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard label="Pending" value={m.pending} icon={ListTodo} tone={m.pending ? 'warning' : 'default'} />
        <StatCard label="Completed" value={m.done} icon={CheckCircle2} tone="success" />
        <StatCard label="Total" value={m.total} icon={ClipboardList} />
      </div>

      <div className="flex flex-wrap gap-2">
        <TaskDialog />
        {canAssign ? <AssignDialog /> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks…" className="h-9 bg-background/50 pl-9" />
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="h-9 w-full bg-background/50 sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="week">Last 7 days</SelectItem>
            <SelectItem value="month">Last 30 days</SelectItem>
            <SelectItem value="year">Last year</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <Select value={pdfScope} onValueChange={setPdfScope}>
            <SelectTrigger className="h-9 flex-1 bg-background/50 sm:w-40">
              <SelectValue />
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
          ) : !tasks.length ? (
            <EmptyState icon={ListTodo} title={emptyTitle} description={tab === 'mine' ? 'Add your first task above.' : ''} />
          ) : (
            <div className="space-y-2.5">
              {tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  showOwner={tab === 'assigned'}
                  canToggle={tab !== 'assigned'}
                  onToggle={(x) => toggleMut.mutate(x)}
                  onDelete={(x) => setDeleting(x)}
                />
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
