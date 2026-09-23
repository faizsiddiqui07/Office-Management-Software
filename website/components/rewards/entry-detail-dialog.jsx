'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

/**
 * One point entry, expanded: what it was, what it's worth, and — when the points came
 * from a task — that task's whole story (who gave it, when it was due, when it was
 * finished, who approved it).
 *
 * Shared, because the same row is listed in two places: your own points on the Rewards
 * page and a person's points on their detail page. Both must open the same thing.
 */

/** Accepts an ISO instant OR a plain 'YYYY-MM-DD' (earnedYMD). A plain date is read in
 *  UTC so it never slides to the day before for a viewer west of India. */
function fmtDateFull(v) {
  if (!v) return '';
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(String(v));
  const opts = { day: '2-digit', month: 'short', year: 'numeric' };
  return new Date(ymd ? `${v}T00:00:00Z` : v).toLocaleDateString('en-GB', ymd ? { ...opts, timeZone: 'UTC' } : opts);
}

/** What each kind of automatic entry is, in plain words. */
export const SOURCE_LABEL = {
  auto_task: 'Assigned task',
  auto_forward: 'Forwarded a task',
  auto_assign: 'Work you assigned',
  auto_streak: 'Punctual streak',
  auto_late: 'Late arrival',
  auto_ot: 'Overtime',
  auto_absent: 'Absent day',
  auto_noleave: 'No leave taken',
  auto_perfect: 'Perfect attendance',
  manual: 'Awarded by leadership',
};

const Pts = ({ n }) => (
  <span className={n < 0 ? 'font-medium text-destructive' : 'font-medium text-emerald-600 dark:text-emerald-300'}>
    {n > 0 ? `+${n}` : n}
  </span>
);

function Fact({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between gap-3 py-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

/** The full story of a task behind a point entry. */
function TaskFacts({ task }) {
  const collabs = (task.collaborators || []).map((c) => c.name).filter(Boolean).join(', ');
  return (
    <div className="divide-y divide-border/50 rounded-xl bg-foreground/[0.03] px-3.5 ring-1 ring-border/50">
      <Fact label="Task" value={task.title} />
      <Fact label="Assigned by" value={task.assignedBy?.name || task.originalAssignedBy?.name} />
      <Fact label="Assigned on" value={fmtDateFull(task.createdAt)} />
      <Fact label="Due date" value={task.dueYMD ? fmtDateFull(task.dueYMD) : 'No deadline'} />
      {task.requiresApproval ? <Fact label="Submitted" value={fmtDateFull(task.submittedAt)} /> : null}
      <Fact label="Completed on" value={fmtDateFull(task.completedAt)} />
      <Fact label="Completed by" value={task.completedBy?.name} />
      {task.approvedBy?.name ? <Fact label="Approved by" value={task.approvedBy.name} /> : null}
      <Fact label="Status" value={task.status === 'DONE' ? 'Done' : 'Pending'} />
      {collabs ? <Fact label="Tagged" value={collabs} /> : null}
      {task.notes ? <Fact label="Notes" value={task.notes} /> : null}
    </div>
  );
}

/**
 * @param entry        the point entry, or null when nothing is open
 * @param onOpenChange called with `false` when the dialog is dismissed
 * @param whose        name of the person, when these are somebody else's points — the
 *                     wording for an automatic entry then says "their" instead of "your"
 */
export function EntryDetailDialog({ entry, onOpenChange, whose }) {
  const isTask = ['auto_task', 'auto_forward', 'auto_assign'].includes(entry?.source) && !!entry?.taskRef;
  const { data: task, isLoading, isError } = useQuery({
    queryKey: ['task', entry?.taskRef],
    queryFn: () => api.get(`/tasks/${entry.taskRef}`),
    enabled: isTask,
    select: (r) => r.task,
  });

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-2">{entry?.reason}</DialogTitle>
          {/* The date is when the POINTS were counted — for a task that's the day it was
              completed/approved, NOT when it was assigned (the facts below show those).
              Labelled so "Assigned task · 13 Jul" isn't misread as "assigned on 13 Jul". */}
          <DialogDescription>
            {SOURCE_LABEL[entry?.source] || 'Points'} · {(entry?.points ?? 0) < 0 ? 'counted' : 'earned'}{' '}
            {fmtDateFull(entry?.earnedYMD || entry?.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-xl bg-foreground/[0.03] px-3.5 py-3 ring-1 ring-border/50">
          <span className="text-sm text-muted-foreground">Points</span>
          <span className="text-base"><Pts n={entry?.points ?? 0} /></span>
        </div>

        {isTask ? (
          isLoading ? (
            <p className="py-2 text-center text-sm text-muted-foreground">Loading task…</p>
          ) : isError ? (
            <p className="py-2 text-center text-sm text-muted-foreground">Couldn’t load the task’s details.</p>
          ) : task ? (
            <TaskFacts task={task} />
          ) : null
        ) : (
          <p className="text-sm text-muted-foreground">
            {entry?.source === 'manual'
              ? 'Given by leadership.'
              : whose
                ? `Earned automatically from ${whose}’s attendance and work records.`
                : 'Earned automatically from your attendance and work records.'}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
