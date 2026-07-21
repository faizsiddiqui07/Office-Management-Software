'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CheckCircle2, ClipboardList, Clock, Download, Eye, EyeOff, FolderOpen, Forward, ListTodo, Pencil, Search, Send, ThumbsUp, Trash2, Undo2, UserRound, Users, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
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
import { ForwardDialog } from './forward-dialog';
import { DateRange } from '@/components/ui/date-range';
import { PDF_SCOPES, downloadTasksPdf, isOverdue, todayYMD } from '@/lib/task';

const PERIODS = [
  { value: 'all', label: 'All Time' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'year', label: 'Last year' },
  { value: 'custom', label: 'Custom range' },
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

/** Teammates' progress on a multi-assign task — each person does their OWN copy, so
 *  everyone can see who's finished and who hasn't. */
function SiblingProgress({ siblings }) {
  if (!siblings?.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="text-muted-foreground">Team:</span>
      {siblings.map((s) => (
        <span key={s.id} className={cn('inline-flex items-center gap-0.5', s.status === 'DONE' ? 'text-success' : 'text-muted-foreground')}>
          {s.status === 'DONE' ? <Check className="size-3" /> : <Clock className="size-3" />}
          {s.owner?.name?.split(' ')[0] || '—'}
        </span>
      ))}
    </span>
  );
}

/** Amber "awaiting approval" chip and the red "sent back" reason, shown wherever a task
 *  appears so both sides always know where an approval-gated task stands. */
function ApprovalState({ task, className }) {
  if (task.awaitingApproval) {
    return <StatusBadge tone="warning" dot={false} className={className}><Clock className="size-3" /> Awaiting approval</StatusBadge>;
  }
  if (task.rejectionReason && task.status !== 'DONE') {
    return <span className={cn('inline-flex items-start gap-1 text-xs font-medium text-destructive', className)}><X className="mt-0.5 size-3 shrink-0" /> Sent back: {task.rejectionReason}</span>;
  }
  return null;
}

/**
 * Read receipt for delegated work — the difference between "sent" and "actually read",
 * so the person who assigned it isn't left guessing. Wording flips depending on which
 * side is looking: the assigner learns it was seen, the assignee is reassured that the
 * assigner knows.
 */
function SeenState({ task, myId }) {
  if (!task.assignedBy) return null; // a personal note has nobody to report to
  const mine = task.owner?.id === myId;
  if (task.seenAt) {
    return (
      <span className="inline-flex items-center gap-1 text-primary" title={`Seen ${fmtDate(task.seenAt)}`}>
        <Eye className="size-3.5" />
        {mine ? 'You’ve seen this' : `Seen ${fmtDate(task.seenAt)}`}
      </span>
    );
  }
  // Only the assigner benefits from knowing it hasn't been read yet.
  if (mine) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <EyeOff className="size-3.5" /> Delivered · not seen yet
    </span>
  );
}

/** Where forwarded work came from and where it went — the chain stays visible so the
 *  original request is never lost behind whoever passed it on. */
function ForwardTrail({ task }) {
  const origin = task.originalAssignedBy?.name;
  const passedOn = task.forwardedTo || [];
  if (!origin && !passedOn.length) return null;
  return (
    <>
      {origin ? (
        <span className="inline-flex items-center gap-1 text-primary" title={`Originally from ${origin}`}>
          <Forward className="size-3" /> via {task.assignedBy?.name?.split(' ')[0]} · from {origin}
        </span>
      ) : null}
      {passedOn.length ? (
        <span className="inline-flex items-center gap-1">
          <Forward className="size-3" /> Forwarded to{' '}
          <span className="font-medium text-foreground">{passedOn.map((f) => f.owner?.name).filter(Boolean).join(', ')}</span>
          {passedOn.every((f) => f.status === 'DONE') ? <span className="text-success">· done</span> : null}
        </span>
      ) : null}
    </>
  );
}

/** Personal / history task row — tap the row for full details, the circle to complete. */
function TaskRow({ task, myId, canToggle, onToggle, onEdit, onDelete, onOpen }) {
  const done = task.status === 'DONE';
  const awaiting = task.awaitingApproval;
  const overdue = !done && !awaiting && isOverdue(task.dueYMD);
  // Where the task comes from (delegator, or a shared task's owner if it's not me).
  const from = task.assignedBy || (myId && task.owner && task.owner.id && task.owner.id !== myId ? task.owner : null);
  // Only my OWN, non-delegated task can be edited/deleted here. A delegated or
  // shared-with-me task: I can complete it, but not change or remove it.
  const canManage = task.owner?.id === myId && !task.assignedBy;
  const sharedWith = canManage && task.collaborators?.length ? task.collaborators : [];
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
        aria-label={done ? 'Mark as not done' : awaiting ? 'Withdraw submission' : 'Mark as done'}
        className={cn('group/tgl -m-2.5 -mt-2 flex size-10 shrink-0 items-center justify-center', !canToggle && 'cursor-default')}
      >
        <span
          className={cn(
            'flex size-5 items-center justify-center rounded-full ring-1 transition-colors',
            done ? 'bg-success text-white ring-success' : awaiting ? 'bg-warning/20 text-amber-600 ring-warning dark:text-amber-300' : 'ring-border',
            canToggle && !done && !awaiting && 'group-hover/tgl:ring-primary',
            !canToggle && 'opacity-70',
          )}
        >
          {done ? <Check className="size-3.5" /> : awaiting ? <Clock className="size-3" /> : null}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('font-medium leading-snug', done && 'text-muted-foreground line-through')}>{task.title}</p>
        {task.notes ? <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">{task.notes}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {from ? (
            <span>
              From: <span className="font-medium text-foreground">{from.name}</span>
            </span>
          ) : null}
          {sharedWith.length ? (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" /> Shared with{' '}
              <span className="font-medium text-foreground">
                {sharedWith.slice(0, 2).map((c) => c.name).join(', ')}
                {sharedWith.length > 2 ? ` +${sharedWith.length - 2}` : ''}
              </span>
            </span>
          ) : null}
          {task.dueYMD ? <span className={cn(overdue && 'font-medium text-destructive')}>Due {fmtDate(task.dueYMD)}</span> : null}
          {task.requiresApproval && !done && !awaiting ? <span className="inline-flex items-center gap-1 text-primary"><ThumbsUp className="size-3" /> Needs approval</span> : null}
          {done && task.completedAt ? <span className="text-success">Done {fmtDate(task.completedAt)}{task.completedBy && task.completedBy.id !== myId ? ` · by ${task.completedBy.name}` : ''}</span> : null}
          {task.siblings?.length ? <SiblingProgress siblings={task.siblings} /> : null}
          <ForwardTrail task={task} />
          <SeenState task={task} myId={myId} />
          <ApprovalState task={task} />
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        {/* Edit/Delete only on my OWN task. A delegated or shared-with-me task can be
            completed but not changed or removed by me. */}
        {canManage ? (
          <>
            <Button variant="ghost" size="icon" className="size-10 sm:size-8" onClick={(e) => { e.stopPropagation(); onEdit(task); }} aria-label="Edit">
              <Pencil className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-10 text-destructive sm:size-8" onClick={(e) => { e.stopPropagation(); onDelete(task); }} aria-label="Delete">
              <Trash2 className="size-4" />
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** A date-grouped list of a person's tasks (inside the folder dialog). */
function DatedTaskList({ tasks, myId, dateKey, ascending = false, onEdit, onDelete, onOpen, onToggle, canToggle = false, allowEdit = () => true, allowDelete = () => true }) {
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
            const awaiting = t.awaitingApproval;
            const overdue = !done && !awaiting && isOverdue(t.dueYMD);
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
                        done ? 'bg-success text-white ring-success' : awaiting ? 'bg-warning/20 text-amber-600 ring-warning dark:text-amber-300' : 'ring-border group-hover/tgl:ring-primary',
                      )}
                    >
                      {done ? <Check className="size-3.5" /> : awaiting ? <Clock className="size-3" /> : null}
                    </span>
                  </button>
                ) : (
                  <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', done ? 'bg-success' : awaiting ? 'bg-warning' : 'bg-warning')} />
                )}
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium', done && 'text-muted-foreground line-through')}>{t.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {t.dueYMD ? <span className={cn(overdue && 'font-medium text-destructive')}>Due {fmtDate(t.dueYMD)}</span> : null}
                    {done && t.completedAt ? <span className="text-success">Done {fmtDate(t.completedAt)}{t.completedBy?.name ? ` · by ${t.completedBy.name}` : ''}</span> : null}
                    {t.siblings?.length ? <SiblingProgress siblings={t.siblings} /> : null}
                    <SeenState task={t} myId={myId} />
                    <ApprovalState task={t} />
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
function PersonFolder({ folder, myId, onEdit, onDelete, onOpen, onToggle, onExpand, canToggle = false, allowEdit = () => true, allowDelete = () => true }) {
  const [open, setOpen] = React.useState(false);
  const pct = folder.total ? Math.round((folder.done / folder.total) * 100) : 0;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          onExpand?.(folder.tasks); // its titles are on screen now — count them as seen
        }}
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
            <DatedTaskList myId={myId} tasks={folder.pendingTasks} dateKey={(t) => t.dueYMD || t.createdAt} ascending onEdit={onEdit} onDelete={onDelete} onOpen={onOpen} onToggle={onToggle} canToggle={canToggle} allowEdit={allowEdit} allowDelete={allowDelete} />
          </section>
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="size-4 text-success" /> Completed ({folder.done})
            </h3>
            <DatedTaskList myId={myId} tasks={folder.doneTasks} dateKey={(t) => t.completedAt || t.createdAt} onEdit={onEdit} onDelete={onDelete} onOpen={onOpen} onToggle={onToggle} canToggle={canToggle} allowEdit={allowEdit} allowDelete={allowDelete} />
          </section>
        </div>
      </AppDialog>
    </>
  );
}

/** Full task details — opened by tapping any task row. */
function TaskDetailDialog({ view, myId, onClose, onToggle, onEdit, onDelete, onApprove, onReject, onForward }) {
  const task = view?.task;
  const done = task?.status === 'DONE';
  const awaiting = task?.awaitingApproval;
  const overdue = task && !done && !awaiting && isOverdue(task.dueYMD);
  const iOwn = task && task.owner?.id === myId && !task.assignedBy;
  const sharedWith = iOwn && task?.collaborators?.length ? task.collaborators : [];
  // The assigner reviewing a submitted task can approve or reject it here.
  const canReview = !!view?.assignerView && awaiting;

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
            {canReview ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" className="text-destructive" onClick={() => onReject(task)}>
                  <X className="size-4" /> Reject
                </Button>
                <Button onClick={() => onApprove(task)}>
                  <ThumbsUp className="size-4" /> Approve
                </Button>
              </div>
            ) : view.canToggle ? (
              <>
                {view.canForward ? (
                  <Button variant="outline" onClick={() => onForward(task)}>
                    <Forward className="size-4" /> Forward
                  </Button>
                ) : null}
              <Button variant={done || awaiting ? 'outline' : 'default'} onClick={() => onToggle(task)}>
                {done ? (
                  <><Undo2 className="size-4" /> Mark not done</>
                ) : awaiting ? (
                  <><Undo2 className="size-4" /> Withdraw</>
                ) : task.requiresApproval ? (
                  <><Send className="size-4" /> Submit for approval</>
                ) : (
                  <><Check className="size-4" /> Mark as done</>
                )}
              </Button>
              </>
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
            <StatusBadge tone={done ? 'success' : 'warning'}>{done ? 'Done' : awaiting ? 'Submitted' : 'Pending'}</StatusBadge>
            {awaiting ? <StatusBadge tone="warning" dot={false}><Clock className="size-3" /> Awaiting approval</StatusBadge> : null}
            {task.requiresApproval && !done && !awaiting ? <StatusBadge tone="primary" dot={false}><ThumbsUp className="size-3" /> Needs approval</StatusBadge> : null}
            {overdue ? <StatusBadge tone="destructive">Overdue</StatusBadge> : null}
            {view?.batchCount > 1 ? (
              <StatusBadge tone="primary" dot={false}>
                <Users className="size-3" /> Assigned to {view.batchCount} people
              </StatusBadge>
            ) : null}
          </div>

          {task.rejectionReason && !awaiting && !done ? (
            <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive ring-1 ring-destructive/20">
              <X className="mt-0.5 size-4 shrink-0" />
              <span><span className="font-semibold">Sent back:</span> {task.rejectionReason}</span>
            </div>
          ) : null}

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
              ) : task.owner?.name && task.owner.id !== myId ? (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-3.5 text-primary" /> Shared by {task.owner.name}
                </span>
              ) : sharedWith.length ? (
                'Shared task'
              ) : (
                'Personal task'
              )}
            </Row>
            {sharedWith.length ? (
              <Row label="Shared with">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-3.5 text-primary" /> {sharedWith.map((c) => c.name).join(', ')}
                </span>
              </Row>
            ) : null}
            {task.siblings?.length ? (
              <Row label="Team">
                <SiblingProgress siblings={task.siblings} />
              </Row>
            ) : null}
            {task.assignedBy ? (
              <Row label="Read">
                {task.seenAt ? (
                  <span className="inline-flex items-center gap-1.5 text-primary">
                    <Eye className="size-3.5" /> Seen {fmtDate(task.seenAt)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <EyeOff className="size-3.5" /> Not seen yet
                  </span>
                )}
              </Row>
            ) : null}
            <Row label="Due date">{task.dueYMD ? fmtDate(task.dueYMD) : '—'}</Row>
            <Row label="Created">{fmtDate(task.createdAt)}</Row>
            {done ? (
              <Row label="Completed">
                {task.completedBy?.name ? <span className="inline-flex items-center gap-1.5"><UserRound className="size-3.5 text-success" /> {task.completedBy.name}{task.completedAt ? ` · ${fmtDate(task.completedAt)}` : ''}</span> : task.completedAt ? fmtDate(task.completedAt) : '—'}
              </Row>
            ) : null}
            {done && task.approvedBy?.name ? <Row label="Approved by">{task.approvedBy.name}</Row> : null}
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
  const [range, setRange] = React.useState({ from: '', to: '' }); // for period === 'custom'
  const [pdfScope, setPdfScope] = React.useState('all');
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const [deleting, setDeleting] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const [viewing, setViewing] = React.useState(null);
  const [forwarding, setForwarding] = React.useState(null); // task being passed further down

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
    queryKey: ['tasks', 'list', scope, status, isMine || isAssigned ? '' : debouncedSearch, isMine ? 'all' : period, isMine ? '' : `${range.from}~${range.to}`],
    queryFn: () => {
      const p = new URLSearchParams({ scope, limit: '10000' });
      if (status) p.set('status', status);
      // My tasks & Assigned search client-side (task text + person name); History uses the server.
      if (!isMine && !isAssigned && debouncedSearch) p.set('search', debouncedSearch);
      // My tasks always shows each assigner's full history, so no period trimming there.
      if (!isMine) {
        if (period === 'custom') {
          if (range.from) p.set('from', range.from);
          if (range.to) p.set('to', range.to);
        } else if (period && period !== 'all') {
          p.set('period', period);
        }
      }
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
    const myId = user?.id;
    const q = search.toLowerCase().trim();
    const textHit = (t) => t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q);
    // Who a task "comes from" (for grouping into a folder): the person who delegated
    // it, or — for a shared task I'm only tagged on — its owner. My own tasks: none.
    const fromOf = (t) => {
      if (t.assignedBy) return t.assignedBy;
      if (myId && t.owner && t.owner.id && t.owner.id !== myId) return t.owner;
      return null;
    };
    const matchesRow = (t) => {
      const f = fromOf(t);
      return !q || textHit(t) || (f?.name || '').toLowerCase().includes(q);
    };

    const byPerson = new Map();
    const personal = [];
    for (const t of tasks) {
      const from = fromOf(t);
      if (from) {
        const id = from.id || String(from);
        if (!byPerson.has(id)) byPerson.set(id, { id, name: from.name || 'Unknown', tasks: [] });
        byPerson.get(id).tasks.push(t);
      } else if (t.status !== 'DONE') {
        personal.push(t); // my own pending tasks (completed ones live in History)
      }
    }

    // A person only anchors a folder while they have PENDING work for me. Once it's
    // all done, that relationship lives in History — not this pending-focused view.
    const active = [...byPerson.values()].filter((f) => f.tasks.some((t) => t.status !== 'DONE'));

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
  }, [isMine, tasks, search, user?.id]);

  // My OWN task (not delegated to me, not just shared with me) → I can edit/delete it.
  const canMgr = (t) => t.owner?.id === user?.id && !t.assignedBy;

  // How many live copies each multi-assign batch has (for the "N people" badge and
  // the batch-edit switch). Computed from the loaded list of the current tab.
  const batchCounts = React.useMemo(() => {
    const m = {};
    for (const t of tasks) if (t.assignBatch) m[t.assignBatch] = (m[t.assignBatch] || 0) + 1;
    return m;
  }, [tasks]);
  const batchCountOf = (t) => (t?.assignBatch ? batchCounts[t.assignBatch] || 0 : 0);

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

  // Everything submitted and waiting for the assigner to approve/reject — surfaced at
  // the top of "Assigned by me" so nothing sits in limbo.
  const awaitingList = React.useMemo(() => {
    if (!isAssigned) return [];
    const q = search.toLowerCase().trim();
    return tasks.filter((t) => t.awaitingApproval && (!q || (t.owner?.name || '').toLowerCase().includes(q)));
  }, [isAssigned, tasks, search]);

  // Each person completes their OWN copy. Marking "done" on an approval-gated task
  // submits it for review; tapping again on a submitted one withdraws it.
  const toggleMut = useMutation({
    mutationFn: (t) => {
      const next = t.awaitingApproval || t.status === 'DONE' ? 'PENDING' : 'DONE';
      return api.patch(`/tasks/${t.id}/status`, { status: next });
    },
    onSuccess: (res) => {
      if (res?.task?.awaitingApproval) toast.success('Submitted for approval');
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not update the task'),
  });

  // The assigner approves or rejects a submitted task — a rejection carries a reason.
  const [rejecting, setRejecting] = React.useState(null);
  const [rejectReason, setRejectReason] = React.useState('');
  const reviewMut = useMutation({
    mutationFn: ({ id, approve, reason }) => api.patch(`/tasks/${id}/review`, { approve, reason }),
    onSuccess: (_res, vars) => {
      toast.success(vars.approve ? 'Task approved' : 'Sent back to the assignee');
      qc.invalidateQueries({ queryKey: ['tasks'] });
      setRejecting(null);
      setRejectReason('');
    },
    onError: (e) => toast.error(e?.message || 'Could not submit your review'),
  });

  // Having a task listed in front of you counts as having seen it, so the receipt goes
  // out for whatever the list just showed — one request for the lot, not one per task.
  // Opening a single task marks it too, for the rare case it wasn't in a list first.
  const seenMut = useMutation({
    mutationFn: (ids) => api.patch('/tasks/seen', { ids }),
    onSuccess: (res) => {
      if (res?.seen) qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: () => {}, // a read receipt is never worth interrupting someone for
  });

  // Remember what we've already reported this session, so a re-render or a refetch
  // doesn't fire the same receipt again.
  const reported = React.useRef(new Set());
  const reportSeen = React.useCallback(
    (list) => {
      const ids = list
        .filter((t) => t && !t.seenAt && t.assignedBy && t.owner?.id === user?.id && !reported.current.has(t.id))
        .map((t) => t.id);
      if (!ids.length) return;
      ids.forEach((id) => reported.current.add(id));
      seenMut.mutate(ids);
    },
    [user?.id, seenMut],
  );

  // Only what is genuinely on screen. In My tasks that's the flat list; work from
  // several people is tucked inside per-person folders, and a collapsed folder shows
  // no titles — reporting those as read would be a lie, so a folder reports its own
  // tasks when it is opened (below).
  React.useEffect(() => {
    if (isAssigned) return; // the assigner's own view isn't "reading" anyone's task
    reportSeen(isMine ? mine.personalPending : tasks);
  }, [tasks, mine.personalPending, isMine, isAssigned, reportSeen]);

  // Work given to me that I may pass further down: still open, and I have assign access.
  const canForwardTask = (t) => !!t?.assignedBy && t.owner?.id === user?.id && t.status !== 'DONE' && !t.awaitingApproval && canAssign;

  const openTask = (view) => {
    setViewing(view);
    if (view?.task) reportSeen([view.task]);
  };

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
        {!isMine && period === 'custom' ? <DateRange value={range} onChange={setRange} max={todayYMD()} /> : null}
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
            <div className="space-y-6">
              {awaitingList.length ? (
                <div className="space-y-2.5 rounded-2xl bg-warning/[0.06] p-3 ring-1 ring-warning/20 sm:p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Clock className="size-4 text-amber-600 dark:text-amber-300" /> Awaiting your approval
                    <span className="font-normal text-muted-foreground">({awaitingList.length})</span>
                  </h3>
                  <div className="space-y-2">
                    {awaitingList.map((t) => (
                      <div key={t.id} className="flex items-center gap-3 rounded-xl bg-background/60 p-3 ring-1 ring-border/50">
                        <button
                          type="button"
                          onClick={() => setViewing({ task: t, canToggle: false, allowEdit: true, allowDelete: true, assignerView: true, batchCount: batchCountOf(t) })}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-sm font-medium">{t.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {t.owner?.name}
                            {t.submittedAt ? ` · submitted ${fmtDate(t.submittedAt)}` : ''}
                            {t.dueYMD ? ` · due ${fmtDate(t.dueYMD)}` : ''}
                          </p>
                        </button>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button variant="outline" size="icon" className="size-9 text-destructive" onClick={() => { setRejecting(t); setRejectReason(''); }} aria-label="Reject">
                            <X className="size-4" />
                          </Button>
                          <Button size="icon" className="size-9" disabled={reviewMut.isPending} onClick={() => reviewMut.mutate({ id: t.id, approve: true })} aria-label="Approve">
                            <ThumbsUp className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {folders.length ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {folders.map((f) => (
                    <PersonFolder
                      key={f.id}
                      folder={f}
                      onEdit={(x) => setEditing(x)}
                      onDelete={(x) => setDeleting(x)}
                      onOpen={(x) => openTask({ task: x, canToggle: false, allowEdit: true, allowDelete: true, assignerView: true, batchCount: batchCountOf(x) })}
                    />
                  ))}
                </div>
              ) : !awaitingList.length ? (
                <EmptyState icon={Users} title={search ? 'No one matches that name' : 'You haven’t assigned any work'} description={search ? '' : 'Use “Assign work” to give a task to someone below you.'} />
              ) : null}
            </div>
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
                        myId={user?.id}
                        canToggle
                        onToggle={(x) => toggleMut.mutate(x)}
                        onEdit={(x) => setEditing(x)}
                        onDelete={(x) => setDeleting(x)}
                        onOpen={(x) => openTask({ task: x, canToggle: true, allowEdit: canMgr(x), allowDelete: canMgr(x), assignerView: false, canForward: canForwardTask(x) })}
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
                          myId={user?.id}
                          key={f.id}
                          folder={f}
                          canToggle
                          allowEdit={() => false}
                          allowDelete={() => false}
                          onToggle={(x) => toggleMut.mutate(x)}
                          onEdit={(x) => setEditing(x)}
                          onDelete={(x) => setDeleting(x)}
                          onExpand={reportSeen}
                          onOpen={(x) => openTask({ task: x, canToggle: true, allowEdit: false, allowDelete: false, assignerView: false, canForward: canForwardTask(x) })}
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
                  myId={user?.id}
                  canToggle
                  onToggle={(x) => toggleMut.mutate(x)}
                  onEdit={(x) => setEditing(x)}
                  onDelete={(x) => setDeleting(x)}
                  onOpen={(x) => openTask({ task: x, canToggle: true, allowEdit: canMgr(x), allowDelete: canMgr(x), assignerView: false, canForward: canForwardTask(x) })}
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
        <TaskDialog
          task={editing}
          open={!!editing}
          onOpenChange={(o) => (!o ? setEditing(null) : null)}
          batchCount={batchCountOf(editing)}
        />
      ) : null}

      <TaskDetailDialog
        view={viewing}
        myId={user?.id}
        onClose={() => setViewing(null)}
        onToggle={(t) => {
          setViewing(null);
          toggleMut.mutate(t);
        }}
        onApprove={(t) => {
          setViewing(null);
          reviewMut.mutate({ id: t.id, approve: true });
        }}
        onReject={(t) => {
          setViewing(null);
          setRejecting(t);
          setRejectReason('');
        }}
        onEdit={(t) => {
          setViewing(null);
          setEditing(t);
        }}
        onForward={(t) => {
          setViewing(null);
          setForwarding(t);
        }}
        onDelete={(t) => {
          setViewing(null);
          setDeleting(t);
        }}
      />

      {forwarding ? (
        <ForwardDialog task={forwarding} open={!!forwarding} onOpenChange={(o) => (!o ? setForwarding(null) : null)} />
      ) : null}

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

      {/* Reject with a reason — the assignee sees exactly what to fix. */}
      <AppDialog
        open={!!rejecting}
        onOpenChange={(o) => (!o ? (setRejecting(null), setRejectReason('')) : null)}
        title="Send this task back?"
        description={rejecting ? `“${rejecting.title}” will return to ${rejecting.owner?.name || 'the assignee'}'s to-do with your note.` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => { setRejecting(null); setRejectReason(''); }}>Cancel</Button>
            <Button className="text-destructive" variant="outline" disabled={reviewMut.isPending || !rejectReason.trim()} onClick={() => rejecting && reviewMut.mutate({ id: rejecting.id, approve: false, reason: rejectReason.trim() })}>
              <X className="size-4" /> {reviewMut.isPending ? 'Sending…' : 'Send back'}
            </Button>
          </>
        }
      >
        <div className="space-y-1.5 py-2">
          <label htmlFor="reject-reason" className="text-sm font-medium">Reason (what needs fixing?)</label>
          <Textarea id="reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Please redo the north elevation dimensions…" className="bg-background/50" autoFocus />
        </div>
      </AppDialog>
    </div>
  );
}
