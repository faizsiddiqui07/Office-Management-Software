'use client';

import * as React from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Award, Check, CheckCircle2, ClipboardList, Clock, Download, Eye, EyeOff, FolderOpen, Forward, ListTodo, Pencil, Search, Send, ThumbsUp, Trash2, Undo2, UserRound, Users, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/glass/empty-state';
import { StatusBadge } from '@/components/glass/status-badge';
import { LoadingState } from '@/components/glass/skeletons';
import { QueryError } from '@/components/glass/query-error';
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
import { PDF_SCOPES, downloadTasksPdf, isOverdue, todayYMD, onTimeUntil } from '@/lib/task';

// WHICH date a range means, per tab. My tasks and Assigned are lists of work still to be
// done: every date on them is a DEADLINE, they group and sort by it, so that is what a
// range has to mean. Filtering them on when each row happened to be created is what made
// "27–30 July" drop a task plainly marked "Due 27 Jul". History is finished work, where
// the only date that means anything is when it was completed.
const DATE_BASIS = { mine: 'due', tagged: 'due', assigned: 'due', history: 'completed' };

// Presets follow the basis. A deadline window looks FORWARD (what is coming up, what is
// already late); a completion window looks back. Nothing on either list is a no-op.
const DUE_PERIODS = [
  { value: 'all', label: 'Any due date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'next7', label: 'Due in next 7 days' },
  { value: 'next30', label: 'Due in next 30 days' },
  { value: 'custom', label: 'Custom range' },
];
const DONE_PERIODS = [
  { value: 'all', label: 'All time' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'year', label: 'Last year' },
  { value: 'custom', label: 'Custom range' },
];
const PERIODS_FOR = (tab) => (DATE_BASIS[tab] === 'due' ? DUE_PERIODS : DONE_PERIODS);
const PDF_LABELS = Object.fromEntries(PDF_SCOPES.map((s) => [s.value, s.label]));

// Read out under the row, so picking a range visibly does something even when the office
// only has a few weeks of data and "last 30 days" happens to hold everything.
const RANGE_WORDS = {
  week: 'completed in the last 7 days',
  month: 'completed in the last 30 days',
  year: 'completed in the last year',
  overdue: 'overdue',
  next7: 'due in the next 7 days',
  next30: 'due in the next 30 days',
};

// "My tasks" and History return work I OWN plus work someone tagged me on. Telling the
// two apart is the difference between "this is yours to do" and "you're being kept in the
// loop" — and getting it wrong showed a tagged colleague somebody else's assignment as
// their own, complete with a Done button the server would refuse.
const iOwnTask = (t, myId) => !!myId && String(t?.owner?.id) === String(myId);
const onlyTagged = (t, myId) => !!myId && !!t?.owner?.id && !iOwnTask(t, myId);
/**
 * Can I tick this off? Mine to do, or a shared PERSONAL task I'm tagged on — whoever
 * finishes one of those finishes it for everyone. Never delegated work I'm only tagged
 * on: the assignee does that, and the approval gate is theirs. Mirrors setStatus() on the
 * server, which 403s the same cases.
 */
const canCompleteTask = (t, myId) => iOwnTask(t, myId) || !t?.assignedBy;

const STAT_TONE = {
  warning: 'bg-warning/15 text-amber-600 ring-warning/25 dark:text-amber-300',
  success: 'bg-success/12 text-success ring-success/25',
  default: 'bg-primary/12 text-primary ring-primary/20',
};

/** Compact stat that fits three-across on a phone with a clearly visible icon. When
 *  `onClick` is given it becomes a button that drills into that slice of the list. */
function StatMini({ label, value, icon: Icon, tone = 'default', onClick, hint }) {
  const base = 'glass glass-highlight rounded-2xl p-3 text-center sm:p-4';
  const body = (
    <>
      <span className={cn('mx-auto flex size-9 items-center justify-center rounded-xl ring-1', STAT_TONE[tone])}>
        <Icon className="size-[18px]" />
      </span>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </>
  );
  if (!onClick) return <div className={base}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={cn(base, 'w-full cursor-pointer transition-colors hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50')}
    >
      {body}
    </button>
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

/**
 * What un-doing a finished task will actually cost, said plainly.
 *
 * Re-completing scores against the day it is finished, so the honest answer depends on
 * the deadline: still time left — say so and name the date; deadline already gone — warn
 * that it will count as late; no deadline at all — nothing to lose. `graceDays` is the
 * office's setting (0 today, and the wording follows it automatically if that changes).
 */
function undoWarning(task, graceDays = 0) {
  const base = `“${task.title}” will go back to your pending list, and the points it earned will be removed.`;
  const until = onTimeUntil(task.dueYMD, graceDays);
  if (!until) return `${base} It has no due date, so finishing it again scores the same as before.`;
  if (until >= todayYMD()) {
    return `${base} Finish it again by ${fmtDate(until)} and you get them straight back.`;
  }
  return `${base} The deadline (${fmtDate(task.dueYMD)}) has already passed — finishing it again will count as LATE, so it will lose points instead of earning them.`;
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

/** Date AND time in company time — for a read receipt, where the minute matters. */
function fmtDateTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
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
      <span className="inline-flex items-center gap-1 text-primary" title={`Seen ${fmtDateTime(task.seenAt)}`}>
        <Eye className="size-3.5" />
        {mine ? 'You’ve seen this' : `Seen ${fmtDateTime(task.seenAt)}`}
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
function ForwardTrail({ task, myId }) {
  const chain = task.forwardChain || [];
  const origin = task.originalAssignedBy?.name;
  const passedOn = task.forwardedTo || [];
  if (!chain.length && !origin && !passedOn.length) return null;
  return (
    <>
      {/* The full hand-off path: Khaan Aamir → Priyanshi Patel → You. Shown only when
          the work actually passed through someone; a plain one-hop assignment falls
          back to the shorter "from …" line below. */}
      {chain.length ? (
        <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 text-primary">
          <Forward className="size-3 shrink-0" />
          {chain.map((n, i) => (
            <span key={`${n.id ?? n.name}-${i}`} className="inline-flex items-center gap-1">
              {i > 0 ? <span className="text-muted-foreground">→</span> : null}
              <span className={i === chain.length - 1 ? 'font-medium text-foreground' : ''}>
                {n.id && String(n.id) === String(myId) ? 'You' : n.name}
              </span>
            </span>
          ))}
        </span>
      ) : origin ? (
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

/**
 * Personal / history task row — tap the row for full details, the circle to complete.
 *
 * `assignerView` flips it round for "Assigned by me": the interesting person is who the
 * work went TO, not who it came from (which is me), and I may edit or withdraw it.
 */
function TaskRow({ task, myId, canToggle, onToggle, onEdit, onDelete, onOpen, assignerView = false }) {
  const done = task.status === 'DONE';
  const awaiting = task.awaitingApproval;
  const overdue = !done && !awaiting && isOverdue(task.dueYMD);
  // I'm on this row because I was tagged, not because it's mine to do.
  const tagged = !assignerView && onlyTagged(task, myId);
  // Where the task comes from. For a tagged row that is its OWNER — the person actually
  // doing it. Reading `assignedBy` there named the person who handed the work out, which
  // made a task I'm merely watching read exactly like one assigned to me.
  const from = assignerView ? null : tagged ? task.owner : task.assignedBy || null;
  // Only my OWN, non-delegated task can be edited/deleted here. A delegated or
  // shared-with-me task: I can complete it, but not change or remove it. Work I handed
  // out is mine to change, so the assigner's view keeps both.
  const canManage = assignerView || (task.owner?.id === myId && !task.assignedBy);
  const sharedWith = canManage && task.collaborators?.length ? task.collaborators : [];
  // Never offer a button the server will refuse.
  const mayToggle = canToggle && canCompleteTask(task, myId);
  return (
    <div
      onClick={() => onOpen(task)}
      className="flex cursor-pointer items-start gap-3 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50 transition-colors hover:bg-foreground/[0.06]"
    >
      {/* 40px touch target; the visual 20px circle sits inside (negative margins keep layout). */}
      <button
        type="button"
        disabled={!mayToggle}
        onClick={(e) => {
          e.stopPropagation();
          if (mayToggle) onToggle(task);
        }}
        aria-label={!mayToggle ? 'Not yours to complete' : done ? 'Mark as not done' : awaiting ? 'Withdraw submission' : 'Mark as done'}
        className={cn('group/tgl -m-2.5 -mt-2 flex size-10 shrink-0 items-center justify-center', !mayToggle && 'cursor-default')}
      >
        <span
          className={cn(
            'flex size-5 items-center justify-center rounded-full ring-1 transition-colors',
            done ? 'bg-success text-white ring-success' : awaiting ? 'bg-warning/20 text-amber-600 ring-warning dark:text-amber-300' : 'ring-border',
            mayToggle && !done && !awaiting && 'group-hover/tgl:ring-primary',
            !mayToggle && 'opacity-70',
          )}
        >
          {done ? <Check className="size-3.5" /> : awaiting ? <Clock className="size-3" /> : null}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('font-medium leading-snug', done && 'text-muted-foreground line-through')}>{task.title}</p>
        {task.notes ? <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">{task.notes}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {tagged && from ? (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" /> Tagged on{' '}
              <span className="font-medium text-foreground">{from.name}</span>’s task
              {task.assignedBy?.name ? <span className="opacity-70">· from {task.assignedBy.name}</span> : null}
            </span>
          ) : from ? (
            <span>
              From: <span className="font-medium text-foreground">{from.name}</span>
            </span>
          ) : assignerView && task.owner?.name ? (
            <span>
              To: <span className="font-medium text-foreground">{task.owner.name}</span>
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
          <ForwardTrail task={task} myId={myId} />
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
            // Per row, not per folder: a folder can hold work that is mine to finish
            // alongside work I'm only tagged on, and the server refuses the second.
            const rowToggle = canToggle && canCompleteTask(t, myId);
            return (
              <div
                key={t.id}
                onClick={() => onOpen(t)}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-foreground/[0.03] p-2.5 ring-1 ring-border/50 transition-colors hover:bg-foreground/[0.06]"
              >
                {rowToggle ? (
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
                    {/* The hand-off trail belongs here too. It only rendered in the flat
                        row, so a task that had come down a chain lost its origin the
                        moment it landed inside a person's folder. */}
                    <ForwardTrail task={t} myId={myId} />
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
            {/* Grouped by DEADLINE only. Falling back to the creation date filed a task
                with no deadline under a heading that reads exactly like a due date — so
                "Tag list…", which has no due date at all, appeared under 30 Jul. Undated
                work now collects under "No date", where it belongs. */}
            <DatedTaskList myId={myId} tasks={folder.pendingTasks} dateKey={(t) => t.dueYMD} ascending onEdit={onEdit} onDelete={onDelete} onOpen={onOpen} onToggle={onToggle} canToggle={canToggle} allowEdit={allowEdit} allowDelete={allowDelete} />
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
/**
 * E5: what finishing this task is worth in points — pulled fresh when the sheet opens.
 * The server owns the answer (eligibility gate + rule values + what's already been
 * booked), so this only ever renders what it's told; nothing is re-derived here.
 */
function TaskBonusPreview({ preview, done }) {
  if (!preview?.eligible) return null;
  const { onTimePoints, latePoints, overdueDailyPoints, deductedSoFar, earnedSoFar, deadlineYMD } = preview;
  const pastDeadline = deadlineYMD && deadlineYMD < todayYMD();

  let tone = 'text-muted-foreground';
  let body = null;
  if (done) {
    const net = earnedSoFar - deductedSoFar;
    if (net >= 0) {
      tone = 'text-success';
      body = <><span className="font-semibold">+{net} points</span> earned for this task</>;
    } else {
      tone = 'text-amber-600 dark:text-amber-400';
      body = <><span className="font-semibold">{net} points</span> — finished late</>;
    }
  } else if (pastDeadline) {
    tone = 'text-amber-600 dark:text-amber-400';
    body = (
      <>
        {deductedSoFar > 0 ? <><span className="font-semibold">−{deductedSoFar} points</span> deducted so far · </> : null}
        past its deadline — finishing now counts as late
        {overdueDailyPoints > 0 ? <> · −{overdueDailyPoints}/day until done</> : null}
      </>
    );
  } else {
    tone = 'text-success';
    body = (
      <>
        <span className="font-semibold">+{onTimePoints} points</span> if finished on time
        {deadlineYMD ? <> (by {fmtDate(deadlineYMD)})</> : null}
        {latePoints > 0 ? <span className="text-muted-foreground"> · −{latePoints} if late</span> : null}
      </>
    );
  }

  return (
    <div className={cn('flex items-start gap-2 rounded-xl bg-foreground/[0.03] p-3 text-sm ring-1 ring-border/50', tone)}>
      <Award className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{body}</span>
    </div>
  );
}

function TaskDetailDialog({ view, myId, onClose, onToggle, onEdit, onDelete, onApprove, onReject, onForward }) {
  const task = view?.task;
  const done = task?.status === 'DONE';
  const awaiting = task?.awaitingApproval;
  const overdue = task && !done && !awaiting && isOverdue(task.dueYMD);
  // Only assigned tasks can ever earn points — a personal to-do never does, so don't ask.
  const bonusQ = useQuery({
    queryKey: ['task-bonus', task?.id],
    queryFn: () => api.get(`/tasks/${task.id}/bonus-preview`),
    enabled: !!view && !!task?.id && !!task?.assignedBy,
    staleTime: 60_000,
  });
  const preview = bonusQ.data?.preview;
  const iOwn = task && task.owner?.id === myId && !task.assignedBy;
  // Somebody else's task that I was tagged on (never in the assigner's own view, where
  // every row belongs to someone else by definition).
  const tagged = !!task && !view?.assignerView && onlyTagged(task, myId);
  // Who else is on it. Worth showing to a tagged colleague too — they are one of them.
  const sharedWith = (iOwn || tagged) && task?.collaborators?.length ? task.collaborators : [];
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
              {/* Tagged first. Reading `assignedBy` before this printed "Assigned by
                  <boss>" on a task that belongs to a colleague — so being kept in the loop
                  was indistinguishable from being given the work. */}
              {tagged ? (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-3.5 text-primary" /> Shared — you’re tagged on {task.owner?.name}’s task
                </span>
              ) : /* Opened from "Assigned by me", the assigner IS me — printing "Assigned by
                    <my own name>" told them nothing. There, name who it went to instead. */
              task.assignedBy?.name && !(view.assignerView && String(task.assignedBy.id) === String(myId)) ? (
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="size-3.5 text-primary" /> Assigned by {task.assignedBy.name}
                </span>
              ) : task.owner?.name && view.assignerView ? (
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="size-3.5 text-primary" /> Assigned to {task.owner.name}
                </span>
              ) : sharedWith.length ? (
                'Shared task'
              ) : (
                'Personal task'
              )}
            </Row>
            {/* A tagged colleague still needs the origin: whose request it was.  */}
            {tagged && task.assignedBy?.name ? (
              <Row label="Assigned by">
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="size-3.5 text-primary" /> {task.assignedBy.name}
                </span>
              </Row>
            ) : null}
            {/* The full hand-off path — who started it, everyone it went through, and
                where it sits now. The row shows this too; it belongs here as well
                because the detail sheet is where you go to understand a task. */}
            {task.forwardChain?.length ? (
              <Row label="Hand-off">
                <span className="inline-flex flex-wrap items-center justify-end gap-x-1 gap-y-0.5">
                  {task.forwardChain.map((n, i) => (
                    <span key={`${n.id ?? n.name}-${i}`} className="inline-flex items-center gap-1">
                      {i > 0 ? <span className="text-muted-foreground">→</span> : null}
                      <span className={i === task.forwardChain.length - 1 ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
                        {n.id && String(n.id) === String(myId) ? 'You' : n.name}
                      </span>
                    </span>
                  ))}
                </span>
              </Row>
            ) : task.originalAssignedBy?.name ? (
              <Row label="Originally from">
                <span className="inline-flex items-center gap-1.5">
                  <Forward className="size-3.5 text-primary" /> {task.originalAssignedBy.name}
                </span>
              </Row>
            ) : null}
            {task.forwardedTo?.length ? (
              <Row label="Passed on to">
                <span className="inline-flex items-center gap-1.5">
                  <Forward className="size-3.5 text-primary" />
                  {task.forwardedTo.map((f) => f.owner?.name).filter(Boolean).join(', ')}
                  {task.forwardedTo.every((f) => f.status === 'DONE') ? <span className="text-success">· done</span> : null}
                </span>
              </Row>
            ) : null}
            {sharedWith.length ? (
              <Row label={tagged ? 'Also tagged' : 'Shared with'}>
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-3.5 text-primary" />
                  {sharedWith.map((c) => (String(c.id) === String(myId) ? 'You' : c.name)).join(', ')}
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
                    <Eye className="size-3.5" /> Seen {fmtDateTime(task.seenAt)}
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

          <TaskBonusPreview preview={preview} done={done} />
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
  const router = useRouter();
  const requestedTab = params.get('tab');
  const focusTaskId = params.get('task'); // a notification asking to open one exact task
  const [tab, setTab] = React.useState(() =>
    ['mine', 'history', 'tagged', 'assigned'].includes(requestedTab) ? requestedTab : 'mine',
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
  // Stat-card drill-down: a flat, ungrouped list. null = the normal grouped view.
  const [flat, setFlat] = React.useState(null); // null | 'pending' | 'all'

  const isAssigned = tab === 'assigned';
  // Work somebody else owns and tagged me on — its own tab, its own server scope, and
  // deliberately outside every "my tasks" count.
  const isTagged = tab === 'tagged';

  // The tab bar + list sit well below the stat cards — on a phone they're off the bottom
  // of the viewport, so a card tap switches the tab with no visible feedback. When a stat
  // card is used we smooth-scroll down to the list so the switched content is actually on
  // screen. scroll-mt on the wrapper (below) keeps the sticky topbar from covering it.
  const listRef = React.useRef(null);
  const scrollToList = React.useCallback(() => {
    // Wait for React to commit the tab switch so the target is in its final position,
    // then smooth-scroll. rAF runs after the DOM update, before paint.
    requestAnimationFrame(() => {
      listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  // A stat card jumps to "My tasks" and shows exactly that slice, flat — no folders, no
  // date filter, no search in the way. Completed has no flat mode of its own; it just
  // opens History, which already is that list.
  const showFlat = (mode) => {
    setSearch('');
    setPeriod('all');
    setTab('mine');
    setFlat(mode);
    scrollToList();
  };

  // Reset the search box when switching tabs (task-text vs person name).
  React.useEffect(() => setSearch(''), [tab]);

  // Leaving "Custom range" drops the dates with it — otherwise they sit in the query key
  // invisibly and a later return to Custom silently re-applies a range nobody re-picked.
  React.useEffect(() => {
    if (period !== 'custom') setRange({ from: '', to: '' });
  }, [period]);

  // The two preset lists don't overlap ("Overdue" means nothing on finished work), so a
  // preset that doesn't exist on the tab being opened falls back to no filter rather than
  // being sent to the server as a value it would reject. A custom range carries over.
  React.useEffect(() => {
    setPeriod((p) => (p === 'custom' || PERIODS_FOR(tab).some((x) => x.value === p) ? p : 'all'));
  }, [tab]);

  const { data: sum } = useQuery({ queryKey: ['tasks', 'summary'], queryFn: () => api.get('/tasks/summary') });
  // `mine` is owner-only (own to-dos + work delegated to me). Tagged work is counted
  // apart, so the three headline figures describe only what this person is answerable for.
  const m = sum?.mine ?? { pending: 0, done: 0, total: 0 };
  const tg = sum?.tagged ?? { pending: 0, done: 0, total: 0 };

  const isMine = tab === 'mine';
  const scope = isAssigned ? 'assigned' : isTagged ? 'tagged' : 'mine';
  // History fetches completed only. My tasks fetches ALL statuses (folders need
  // pending AND completed together) and splits/groups client-side.
  const status = tab === 'history' ? 'DONE' : '';

  const dateBasis = DATE_BASIS[tab] ?? 'added';

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['tasks', 'list', scope, status, isMine || isAssigned || isTagged ? '' : debouncedSearch, period, `${range.from}~${range.to}`, dateBasis],
    queryFn: () => {
      const p = new URLSearchParams({ scope, limit: '10000', dateBasis });
      if (status) p.set('status', status);
      // My tasks, Tagged & Assigned search client-side (task text + person name); History
      // uses the server.
      if (!isMine && !isAssigned && !isTagged && debouncedSearch) p.set('search', debouncedSearch);
      // The date filter applies to every tab. It used to be suppressed on "My tasks" —
      // which is the tab everyone lands on, so the control was missing exactly where it
      // was being reached for, and picking a range there did nothing at all.
      if (period === 'custom') {
        if (range.from) p.set('from', range.from);
        if (range.to) p.set('to', range.to);
      } else if (period && period !== 'all') {
        p.set('period', period);
      }
      return api.get(`/tasks?${p.toString()}`);
    },
    placeholderData: (prev) => prev, // keep rows visible while a new search loads
    // A read receipt arrives because of something SOMEONE ELSE did, so this view has
    // to go and look — nothing here triggers a refetch on its own. The assigner's tab
    // is the one sitting and waiting ("have they seen it yet?"), so only that one
    // polls; every tab picks changes up the moment the window is focused again.
    // (The app-wide defaults are no focus refetch and a 30s stale time — both are
    // deliberately overridden here.)
    refetchInterval: isAssigned ? 20_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const tasks = React.useMemo(() => data?.tasks ?? [], [data]);

  // My-tasks view: a flat list of personal pending work (nearest-due-first) plus,
  // when 2+ people have delegated work to me, one folder per assigner. A lone
  // assigner's pending tasks fold into the flat list (no folder tap for one person).
  const mine = React.useMemo(() => {
    if (!isMine) return { personalPending: [], folders: [], searching: false };
    const myId = user?.id;
    const q = search.toLowerCase().trim();
    const textHit = (t) => t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q);
    // Who a task "comes from": the person who delegated it, or — for one I'm only tagged
    // on — whoever it actually belongs to. My own tasks: nobody.
    const fromOf = (t) => (onlyTagged(t, myId) ? t.owner : t.assignedBy) || null;
    const matchesRow = (t) => {
      const f = fromOf(t);
      return !q || textHit(t) || (f?.name || '').toLowerCase().includes(q);
    };

    const byPerson = new Map();
    const personal = [];
    const personalDone = []; // kept aside only so a search can still reach them
    for (const t of tasks) {
      // Tagged work never reaches this list any more — the server's `mine` scope is
      // owner-only and tagged rows live in their own tab. The guard stays as a
      // belt-and-braces skip for any legacy row that slips through.
      if (onlyTagged(t, myId)) {
        continue;
      } else if (t.assignedBy) {
        const from = t.assignedBy;
        const id = from.id || String(from);
        if (!byPerson.has(id)) byPerson.set(id, { id, name: from.name || 'Unknown', tasks: [] });
        byPerson.get(id).tasks.push(t);
      } else if (t.status !== 'DONE') {
        personal.push(t); // my own pending tasks (completed ones live in History)
      } else {
        personalDone.push(t);
      }
    }

    // A person only anchors a folder while they have PENDING work for me. Once it's
    // all done, that relationship lives in History — not this pending-focused view.
    const active = [...byPerson.values()].filter((f) => f.tasks.some((t) => t.status !== 'DONE'));

    // SEARCHING flattens everything. A folder is a person, so folders were only ever
    // matched on the person's NAME — which meant a task sitting inside one could not be
    // found by typing its title at all. When there's a search term the grouping is
    // dropped and every matching task is listed, wherever it lives.
    if (q) {
      // Finished work is in here too. A folder lists its completed tasks, so leaving them
      // out of the search would mean a task you can SEE by opening a folder can't be
      // found by typing its name — which is the whole complaint.
      const all = [...personal, ...personalDone, ...[...byPerson.values()].flatMap((f) => f.tasks)];
      const hits = all
        .filter((t) => textHit(t) || (fromOf(t)?.name || '').toLowerCase().includes(q))
        // Open work first — it's what needs doing; finished rows follow, struck through.
        .sort((a, b) => (a.status === 'DONE') - (b.status === 'DONE') || byDueDate(a, b));
      return { personalPending: hits, folders: [], searching: true };
    }

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
    return { personalPending, folders, searching: false };
  }, [isMine, tasks, search, user?.id]);

  /**
   * The Tagged tab: colleagues' tasks I was tagged on — pending first, finished after.
   * Fetched with its own server scope, so nothing here can leak into "My tasks" and
   * nothing from my own list can appear here. Searchable by task text, the owner's name
   * or whoever assigned it.
   */
  const taggedList = React.useMemo(() => {
    if (!isTagged) return [];
    const q = search.toLowerCase().trim();
    return tasks
      .filter((t) => !q
        || t.title.toLowerCase().includes(q)
        || (t.notes || '').toLowerCase().includes(q)
        || (t.owner?.name || '').toLowerCase().includes(q)
        || (t.assignedBy?.name || '').toLowerCase().includes(q))
      .sort((a, b) => (a.status === 'DONE') - (b.status === 'DONE') || byDueDate(a, b));
  }, [isTagged, tasks, search]);

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

  // Assigned work, grouped into a folder per person. A search term matches the person OR
  // the task itself and flattens the grouping — see `assignedHits` below.
  const folders = React.useMemo(() => {
    if (!isAssigned) return [];
    const q = search.toLowerCase().trim();
    if (q) return []; // searching shows a flat list instead
    const byOwner = new Map();
    for (const t of tasks) {
      const id = t.owner?.id || String(t.owner);
      if (!byOwner.has(id)) byOwner.set(id, { id, name: t.owner?.name || 'Unknown', tasks: [] });
      byOwner.get(id).tasks.push(t);
    }
    return [...byOwner.values()]
      .map((f) => {
        const pendingTasks = f.tasks.filter((t) => t.status !== 'DONE');
        const doneTasks = f.tasks.filter((t) => t.status === 'DONE');
        return { ...f, pendingTasks, doneTasks, pending: pendingTasks.length, done: doneTasks.length, total: f.tasks.length };
      })
      .sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));
  }, [isAssigned, tasks, search]);

  // Flat search results for "Assigned by me": any task whose title, notes or assignee
  // matches — folders can't hide it.
  const assignedHits = React.useMemo(() => {
    if (!isAssigned) return null;
    const q = search.toLowerCase().trim();
    if (!q) return null;
    return tasks
      .filter((t) =>
        t.title.toLowerCase().includes(q)
        || (t.notes || '').toLowerCase().includes(q)
        || (t.owner?.name || '').toLowerCase().includes(q),
      )
      .sort(byDueDate);
  }, [isAssigned, tasks, search]);

  // Everything submitted and waiting for the assigner to approve/reject — surfaced at
  // the top of "Assigned by me" so nothing sits in limbo.
  //
  // Deliberately its OWN query, not a slice of the list above: someone waiting on an
  // approval is blocked, and a date range picked for browsing must not be able to hide
  // them. Longest wait first, straight from the server.
  const { data: awaitingData } = useQuery({
    queryKey: ['tasks', 'awaiting'],
    queryFn: () => api.get('/tasks?scope=assigned&awaiting=1&limit=500'),
    enabled: isAssigned,
    refetchInterval: isAssigned ? 20_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const awaitingList = React.useMemo(() => {
    if (!isAssigned) return [];
    const q = search.toLowerCase().trim();
    return (awaitingData?.tasks ?? []).filter(
      (t) => t.awaitingApproval
        && (!q
          || (t.owner?.name || '').toLowerCase().includes(q)
          || t.title.toLowerCase().includes(q)
          || (t.notes || '').toLowerCase().includes(q)),
    );
  }, [isAssigned, awaitingData, search]);

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

  // Un-doing a FINISHED delegated task takes back the points it earned (and clears the
  // assigner's approval), so it asks first — a mis-tap on a done task shouldn't quietly
  // cost somebody their +points. Everything else (completing, submitting, withdrawing, and
  // your own personal to-dos) toggles straight through as before.
  const [undoing, setUndoing] = React.useState(null);
  const handleToggle = (t) => {
    if (t?.status === 'DONE' && !t?.awaitingApproval && t?.assignedBy) { setUndoing(t); return; }
    toggleMut.mutate(t);
  };

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

  // Everything this person's own to-do just loaded counts as delivered to them —
  // whether it sits in the flat list or inside a per-person folder, finished or not.
  //
  // This used to report only `mine.personalPending`, which merges an assigner's tasks
  // in ONLY when exactly one person has given you work (see the memo above); with two
  // or more, their tasks stayed folded away and were reported just on expanding the
  // folder, and completed ones never at all. That is why receipts landed on some
  // tasks and not others. Waiting for a folder to be opened was the more literal
  // reading of "seen", but it made the receipt unreliable, which is worse than
  // slightly generous: a folder still shows who it's from and how much is in it.
  React.useEffect(() => {
    if (isAssigned) return; // the assigner's own view isn't "reading" anyone's task
    reportSeen(tasks);
  }, [tasks, isAssigned, reportSeen]);

  // Work given to me that I may pass further down: still open, and I have assign access.
  const canForwardTask = (t) => !!t?.assignedBy && t.owner?.id === user?.id && t.status !== 'DONE' && !t.awaitingApproval && canAssign;

  const openTask = (view) => {
    setViewing(view);
    if (view?.task) reportSeen([view.task]);
  };

  // Deep link from a notification: /todo?task=<id> opens that exact task's dialog, the
  // same one a click on its row would. The link already carries the right tab, so the
  // task is in this tab's loaded list. Once opened, strip ?task= from the URL so closing
  // the dialog (or a refresh) doesn't reopen it; the ref guards against a re-open in the
  // gap before the URL settles.
  const focusedRef = React.useRef(null);
  React.useEffect(() => {
    if (!focusTaskId || focusedRef.current === focusTaskId) return;
    const t = tasks.find((x) => String(x.id) === String(focusTaskId));
    if (!t) return; // list still loading, or not on this tab — try again on the next render
    focusedRef.current = focusTaskId;
    const assignerView = isAssigned;
    openTask({
      task: t,
      canToggle: assignerView ? false : canCompleteTask(t, user?.id),
      allowEdit: assignerView ? true : canMgr(t),
      allowDelete: assignerView ? true : canMgr(t),
      assignerView,
      canForward: assignerView ? false : canForwardTask(t),
      batchCount: batchCountOf(t),
    });
    const sp = new URLSearchParams(Array.from(params.entries()));
    sp.delete('task');
    router.replace(`/todo${sp.toString() ? `?${sp}` : ''}`, { scroll: false });
  }, [focusTaskId, tasks, isAssigned, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // `viewing` holds the task as it was when the row was tapped. An assigner watching
  // for a receipt sits on exactly this dialog, so a snapshot would stay frozen on
  // "Not seen yet" however often the list behind it refreshed. Re-read the task from
  // the current list each render and keep only the view's own flags.
  const viewingLive = React.useMemo(() => {
    if (!viewing?.task) return viewing;
    const fresh = tasks.find((t) => t.id === viewing.task.id);
    return fresh ? { ...viewing, task: fresh } : viewing;
  }, [viewing, tasks]);

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
      // The PDF prints the rows currently on screen — same list, same range, same search
      // — so the download can never disagree with what was just read. `scope` already
      // carries which list this is (mine / tagged / assigned).
      await downloadTasksPdf(pdfScope, scope, {
        period,
        dateBasis,
        from: period === 'custom' ? range.from : '',
        to: period === 'custom' ? range.to : '',
        search: debouncedSearch,
      });
    } catch (e) {
      toast.error(e?.message || 'Could not download');
    } finally {
      setPdfBusy(false);
    }
  };

  // Spell out the range that is in force, with the count, right under the controls.
  // Suppressed while searching: the results list prints its own "N matches" heading and
  // two counts side by side, measuring different things, would read as a contradiction.
  const filterNote = React.useMemo(() => {
    if (search.trim()) return '';
    let when = RANGE_WORDS[period] || '';
    if (period === 'custom') {
      if (!range.from && !range.to) return '';
      const word = dateBasis === 'due' ? 'due' : 'completed';
      when = range.from && range.to
        ? `${word} between ${fmtDate(range.from)} and ${fmtDate(range.to)}`
        : range.from ? `${word} from ${fmtDate(range.from)}` : `${word} up to ${fmtDate(range.to)}`;
    }
    if (!when) return '';
    const n = tasks.length;
    let note = `${n} ${n === 1 ? 'task' : 'tasks'} ${when}.`;
    // Work with no deadline can't be inside a deadline window, so it isn't listed. Say
    // how much — a task that vanishes without a word is how a filter gets blamed for
    // losing things.
    const hidden = data?.noDueHidden ?? 0;
    if (hidden) note += ` ${hidden} more with no due date ${hidden === 1 ? 'is' : 'are'} not shown.`;
    return note;
  }, [period, range, tasks.length, dateBasis, search, data?.noDueHidden]);

  // The stat-card drill-down: one flat list, no folders. 'pending' = everything not done;
  // 'all' = every task, finished ones after the open ones. Due-date first, undated last
  // (byDueDate). Stands down while there's a search, which takes over the same space.
  const flatList = React.useMemo(() => {
    if (!isMine || !flat || search.trim()) return null;
    const rows = flat === 'pending' ? tasks.filter((t) => t.status !== 'DONE') : [...tasks];
    return rows.sort((a, b) => (a.status === 'DONE') - (b.status === 'DONE') || byDueDate(a, b));
  }, [isMine, flat, search, tasks]);

  return (
    <div className="space-y-6">
      {/* Four across is too tight on a phone, so it's 2×2 there and a single row from sm up. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatMini label="Pending" value={m.pending} icon={ListTodo} tone={m.pending ? 'warning' : 'default'} onClick={() => showFlat('pending')} hint="Show every pending task, flat" />
        <StatMini label="Completed" value={m.done} icon={CheckCircle2} tone="success" onClick={() => { setFlat(null); setTab('history'); scrollToList(); }} hint="See completed tasks" />
        <StatMini label="Total" value={m.total} icon={ClipboardList} onClick={() => showFlat('all')} hint="Show every task, flat" />
        {/* Its own box, never folded into Total: being tagged is being kept in the loop,
            not being given the work. */}
        <StatMini label="Tagged" value={tg.total} icon={Users} onClick={() => { setFlat(null); setTab('tagged'); scrollToList(); }} hint="Tasks you’re tagged on — someone else does them" />
      </div>

      <div className="flex flex-wrap gap-2">
        <TaskDialog />
        {canAssign ? <AssignDialog /> : null}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks or people…"
              className="h-9 bg-background/50 pl-9"
            />
          </div>
          {/* One date filter, and the option labels themselves say which date it means —
              deadlines on the two work lists, completion date on History. */}
          <Select value={period} onValueChange={(v) => { setPeriod(v); setFlat(null); }}>
            <SelectTrigger className="h-9 w-full bg-background/50 sm:w-48">
              <span className="line-clamp-1">
                {period === 'custom' && dateBasis === 'due'
                  ? 'Due in a date range'
                  : PERIODS_FOR(tab).find((p) => p.value === period)?.label ?? 'All time'}
              </span>
            </SelectTrigger>
            <SelectContent>
              {PERIODS_FOR(tab).map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* No upper bound on a deadline range — most deadlines are in the future. A
              completion range still can't run past today. */}
          {period === 'custom' ? <DateRange value={range} onChange={setRange} max={dateBasis === 'due' ? undefined : todayYMD()} /> : null}
          <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
            {/* This one picks WHAT goes in the download, never a date range — the dropdown
                on the left is the only place a date range is chosen, and the PDF follows it. */}
            <Select value={pdfScope} onValueChange={setPdfScope}>
              <SelectTrigger className="h-9 flex-1 bg-background/50 sm:w-44">
                <span className="line-clamp-1">Include: {PDF_LABELS[pdfScope] ?? 'All work'}</span>
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
        {filterNote ? <p className="px-1 text-xs text-muted-foreground">{filterNote}</p> : null}
      </div>

      {/* Wrapper carries the scroll target + a scroll-margin so a stat-card jump stops just
          below the sticky topbar instead of under it. (Tabs itself doesn't forward a ref.) */}
      <div ref={listRef} className="scroll-mt-24">
      <Tabs value={tab} onValueChange={(v) => { setTab(v); setFlat(null); }}>
        <TabsList>
          <TabsTrigger value="mine">My tasks</TabsTrigger>
          {canAssign ? <TabsTrigger value="assigned">Assigned by me</TabsTrigger> : null}
          <TabsTrigger value="tagged">
            Tagged{tg.total ? <span className="ml-1 text-xs font-normal text-muted-foreground">({tg.total})</span> : null}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="pt-4">
          {isError && !data ? (
            // Without this the list falls back to [] and the "No pending tasks" empty
            // state renders — telling someone their work is done when the request
            // simply never arrived.
            <QueryError title="Couldn’t load your tasks" error={error} onRetry={refetch} />
          ) : isLoading ? (
            <LoadingState label="Loading tasks…" />
          ) : isTagged ? (
            taggedList.length ? (
              <div className="space-y-2.5">
                <p className="px-1 text-xs text-muted-foreground">
                  You’re tagged on these so you can follow them — the person they’re assigned to does the work, and they don’t count towards your own task figures.
                </p>
                {taggedList.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    myId={user?.id}
                    canToggle
                    onToggle={handleToggle}
                    onEdit={(x) => setEditing(x)}
                    onDelete={(x) => setDeleting(x)}
                    onOpen={(x) => openTask({ task: x, canToggle: canCompleteTask(x, user?.id), allowEdit: false, allowDelete: false, assignerView: false })}
                  />
                ))}
                {(data?.total ?? 0) > tasks.length ? (
                  <p className="px-1 text-xs text-muted-foreground">
                    Showing {tasks.length} of {data.total} — narrow the search to see the rest.
                  </p>
                ) : null}
              </div>
            ) : (
              <EmptyState
                icon={Users}
                title={search.trim() ? 'No matching tagged tasks' : 'Nothing shared with you'}
                description={search.trim() ? '' : 'When a colleague tags you on their task, it shows up here.'}
              />
            )
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

              {/* Searching lists every match flat — a task can't be hidden inside a
                  person's folder just because their name doesn't match what was typed. */}
              {assignedHits ? (
                assignedHits.length ? (
                  <div className="space-y-2.5">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      {assignedHits.length} {assignedHits.length === 1 ? 'match' : 'matches'} for “{search.trim()}”
                    </h3>
                    <div className="space-y-2">
                      {assignedHits.map((t) => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          myId={user?.id}
                          assignerView
                          canToggle={false}
                          onToggle={() => {}}
                          onEdit={(x) => setEditing(x)}
                          onDelete={(x) => setDeleting(x)}
                          onOpen={(x) => openTask({ task: x, canToggle: false, allowEdit: true, allowDelete: true, assignerView: true, batchCount: batchCountOf(x) })}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState icon={Users} title="No matching work" description="Nothing you assigned matches that — try a different word." />
                )
              ) : folders.length ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {folders.map((f) => (
                    <PersonFolder
                      key={f.id}
                      folder={f}
                      // Without this the hand-off trail inside the folder prints my own
                      // name instead of "You".
                      myId={user?.id}
                      onEdit={(x) => setEditing(x)}
                      onDelete={(x) => setDeleting(x)}
                      onOpen={(x) => openTask({ task: x, canToggle: false, allowEdit: true, allowDelete: true, assignerView: true, batchCount: batchCountOf(x) })}
                    />
                  ))}
                </div>
              ) : !awaitingList.length ? (
                <EmptyState icon={Users} title="You haven’t assigned any work" description="Use “Assign work” to give a task to someone below you." />
              ) : null}
            </div>
          ) : isMine ? (
            flatList ? (
              flatList.length ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      {flat === 'pending' ? (
                        <><ListTodo className="size-4 text-warning" /> All pending</>
                      ) : (
                        <><ClipboardList className="size-4 text-primary" /> All tasks</>
                      )}
                      <span className="font-normal text-muted-foreground">({flatList.length})</span>
                    </h3>
                    {/* A way back to the folders/sections view. */}
                    <Button variant="ghost" size="sm" onClick={() => setFlat(null)}>Grouped view</Button>
                  </div>
                  {flatList.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      myId={user?.id}
                      canToggle
                      onToggle={handleToggle}
                      onEdit={(x) => setEditing(x)}
                      onDelete={(x) => setDeleting(x)}
                      onOpen={(x) => openTask({ task: x, canToggle: canCompleteTask(x, user?.id), allowEdit: canMgr(x), allowDelete: canMgr(x), assignerView: false, canForward: canForwardTask(x) })}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={flat === 'pending' ? ListTodo : ClipboardList}
                  title={flat === 'pending' ? 'No pending tasks' : 'No tasks yet'}
                  description=""
                />
              )
            ) : !mine.personalPending.length && !mine.folders.length ? (
              <EmptyState
                icon={ListTodo}
                title={search.trim() ? 'No matching tasks' : 'No pending tasks'}
                description={search.trim() ? '' : 'Add your first task above.'}
              />
            ) : (
              <div className="space-y-6">
                {mine.personalPending.length ? (
                  <div className="space-y-2.5">
                    {/* Searching drops the folders and lists every hit flat, so say so —
                        otherwise it reads as though the folders just vanished. */}
                    {mine.searching ? (
                      <h3 className="text-sm font-medium text-muted-foreground">
                        {mine.personalPending.length} {mine.personalPending.length === 1 ? 'match' : 'matches'} for “{search.trim()}”
                      </h3>
                    ) : mine.folders.length ? (
                      /* Heading only appears once there are folders below to distinguish the two. */
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
                        onToggle={handleToggle}
                        onEdit={(x) => setEditing(x)}
                        onDelete={(x) => setDeleting(x)}
                        onOpen={(x) => openTask({ task: x, canToggle: canCompleteTask(x, user?.id), allowEdit: canMgr(x), allowDelete: canMgr(x), assignerView: false, canForward: canForwardTask(x) })}
                      />
                    ))}
                  </div>
                ) : null}

                {/* Tagged work used to sit here as a "Shared with me" section. It now has
                    its own tab and its own stat box, so this list is purely what I own. */}

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
                          onToggle={handleToggle}
                          onEdit={(x) => setEditing(x)}
                          onDelete={(x) => setDeleting(x)}
                          onExpand={reportSeen}
                          onOpen={(x) => openTask({ task: x, canToggle: canCompleteTask(x, user?.id), allowEdit: false, allowDelete: false, assignerView: false, canForward: canForwardTask(x) })}
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
                  onToggle={handleToggle}
                  onEdit={(x) => setEditing(x)}
                  onDelete={(x) => setDeleting(x)}
                  onOpen={(x) => openTask({ task: x, canToggle: canCompleteTask(x, user?.id), allowEdit: canMgr(x), allowDelete: canMgr(x), assignerView: false, canForward: canForwardTask(x) })}
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
      </div>

      {editing ? (
        <TaskDialog
          task={editing}
          open={!!editing}
          onOpenChange={(o) => (!o ? setEditing(null) : null)}
          batchCount={batchCountOf(editing)}
        />
      ) : null}

      <TaskDetailDialog
        view={viewingLive}
        myId={user?.id}
        onClose={() => setViewing(null)}
        onToggle={(t) => {
          setViewing(null);
          handleToggle(t);
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

      {/* Marking a finished task as not-done again — warn about the points first. */}
      <ConfirmDialog
        open={!!undoing}
        onOpenChange={(o) => (!o ? setUndoing(null) : null)}
        title="Mark this as not done?"
        description={undoing ? undoWarning(undoing, data?.graceDays ?? 0) : ''}
        tone="destructive"
        confirmLabel="Yes, reopen it"
        loading={toggleMut.isPending}
        onConfirm={() => { if (undoing) { toggleMut.mutate(undoing); setUndoing(null); } }}
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
