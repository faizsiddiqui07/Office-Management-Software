'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Plus, ThumbsUp, UserRoundPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { useDueDateBlocker } from '@/lib/holidays';
import { companyYMD } from '@/lib/time';
import { APP_LIVE_YMD } from '@/lib/app-live';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

export function TaskDialog({ task, open: openProp, onOpenChange, batchCount = 0 }) {
  const isEdit = !!task;
  const qc = useQueryClient();
  const { user } = useAuth();
  const [openInternal, setOpenInternal] = React.useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = onOpenChange || setOpenInternal;

  // Note: tagging a colleague on your own task needs no delegation access — saying who
  // is working with you isn't handing them work. Only reassigning does, and that's
  // enforced by the server plus the assignable list it returns.

  // Editing a task I delegated to someone (not my own, not a shared task).
  const assignerId = task?.assignedBy?.id || task?.assignedBy || null;
  const isAssignedByMe = isEdit && !!assignerId && String(assignerId) === String(user?.id);

  // Everyone this delegated work currently sits with (owner + its batch siblings).
  const currentAssignees = React.useMemo(() => {
    if (!isAssignedByMe) return [];
    const ids = [task?.owner?.id, ...((task?.siblings || []).map((s) => s.owner?.id))].filter(Boolean);
    return [...new Set(ids.map(String))];
  }, [isAssignedByMe, task]);

  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [dueYMD, setDueYMD] = React.useState('');
  const [collaborators, setCollaborators] = React.useState([]); // tagged teammate ids (personal task)
  const [assignees, setAssignees] = React.useState([]); // who a delegated task is assigned to
  const [requiresApproval, setRequiresApproval] = React.useState(false);
  const [applyToAll, setApplyToAll] = React.useState(true); // batch content edit: push to every copy
  // Sundays + holidays can't be a deadline (the overdue penalty skips those days anyway).
  const dayBlock = useDueDateBlocker();

  // Once work has been handed out its deadline is final — moving it would re-price the
  // points, so only the CEO & President may change it. The SERVER is the real gate (it
  // rejects the patch); this just stops someone typing a date the save would refuse.
  // Work assigned before the rule existed stays editable, exactly as the server allows.
  const DUE_LOCK_FLOOR_YMD = '2026-08-01';
  const assignedOn = task?.createdAt ? companyYMD(task.createdAt) : '';
  const dueLocked = isEdit && !!task?.assignedBy && !user?.isOwner
    && !!assignedOn && assignedOn >= DUE_LOCK_FLOOR_YMD;

  React.useEffect(() => {
    if (!open) return;
    setTitle(task?.title || '');
    setNotes(task?.notes || '');
    setDueYMD(task?.dueYMD || '');
    setCollaborators((task?.collaborators || []).map((c) => c.id).filter(Boolean));
    setAssignees(currentAssignees);
    setRequiresApproval(!!task?.requiresApproval);
    setApplyToAll(true);
  }, [open, task]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: assignData } = useQuery({
    queryKey: ['tasks', 'assignable'],
    queryFn: () => api.get('/tasks/assignable'),
    enabled: open,
  });
  // Reassigning offers only people you may delegate to; tagging offers the whole office.
  const assignablePeople = assignData?.users ?? [];
  const taggablePeople = assignData?.taggable ?? [];

  const toggleCollab = (id) => setCollaborators((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAssignee = (id) =>
    setAssignees((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // Handing the work TO someone stops them being a bystander on it. Their tag chip
      // disappears from the list below either way, but the id lingered in state — so the
      // count read "2 tagged" with one chip lit, and the server (which drops assignees
      // from the tag list) then saved a different number than the screen showed.
      setCollaborators((tags) => tags.filter((x) => x !== id));
      return [...prev, id];
    });

  // Did the assigner change who it's assigned to? (drives whether we reconcile the batch)
  const reassigned = isAssignedByMe && (assignees.length !== currentAssignees.length || assignees.some((id) => !currentAssignees.includes(id)));
  // The "edit every copy vs just this one" switch — only when 2+ copies and not reassigning
  // (a reassignment always applies the content to everyone).
  const showBatchSwitch = isAssignedByMe && !!task?.assignBatch && batchCount > 1 && !reassigned;

  const mut = useMutation({
    mutationFn: () => {
      const body = { title, notes, dueYMD };
      if (isAssignedByMe) {
        body.requiresApproval = requiresApproval;
        if (reassigned) body.assignTo = assignees; // reconcile people (content applies to all)
        else if (showBatchSwitch) body.applyToAll = applyToAll;
      }
      // Tags are editable on delegated work too. They weren't sent here at all, so once a
      // task was assigned its tagged people were frozen — you could see them on the task
      // but never add or remove one.
      body.collaborators = collaborators;
      return isEdit ? api.patch(`/tasks/${task.id}`, body) : api.post('/tasks', body);
    },
    onSuccess: (res) => {
      const n = res?.task?.batchCount;
      toast.success(
        !isEdit
          ? 'Task added'
          : reassigned
            ? 'Task updated & reassigned'
            : showBatchSwitch && applyToAll && n > 1
              ? `Updated for ${n} people`
              : 'Task updated',
      );
      qc.invalidateQueries({ queryKey: ['tasks'] });
      setOpen(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not save the task'),
  });

  const saveLabel = mut.isPending
    ? 'Saving…'
    : !isEdit
      ? 'Add'
      : reassigned
        ? `Save for ${assignees.length} ${assignees.length === 1 ? 'person' : 'people'}`
        : showBatchSwitch
          ? applyToAll ? `Save for ${batchCount} people` : 'Save for this one'
          : 'Save';

  const submit = () => {
    if (!title.trim()) return toast.error('Add the work');
    if (isAssignedByMe && !assignees.length) return toast.error('Pick at least one person to assign this to');
    mut.mutate();
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        isEdit ? undefined : (
          <Button className="w-full sm:w-auto">
            <Plus /> Add task
          </Button>
        )
      }
      title={isEdit ? 'Edit task' : 'Add a task'}
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending}>
            {saveLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 py-2">
        {/* Reassign — change / add / remove who a delegated task is assigned to. */}
        {isAssignedByMe ? (
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><UserRoundPlus className="size-3.5" /> Assigned to</Label>
            {assignablePeople.length ? (
              <div className="flex flex-wrap gap-1.5">
                {assignablePeople.map((p) => {
                  const on = assignees.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleAssignee(p.id)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors',
                        on ? 'bg-primary/12 text-primary ring-primary/25' : 'bg-muted/40 text-muted-foreground ring-border hover:text-foreground',
                      )}
                    >
                      {on ? <Check className="size-3" /> : null}
                      {p.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No one available to assign to.</p>
            )}
            {reassigned ? (
              <p className="text-xs text-primary">Changes will apply to all {assignees.length} {assignees.length === 1 ? 'person' : 'people'}.</p>
            ) : null}
          </div>
        ) : null}

        {/* Batch content scope — edit every copy, or just this one (when not reassigning). */}
        {showBatchSwitch ? (
          <div className="flex items-start justify-between gap-3 rounded-xl bg-primary/[0.06] p-3 ring-1 ring-primary/15">
            <div className="min-w-0">
              <Label className="flex items-center gap-1.5">
                <Users className="size-3.5" /> Apply to all {batchCount} people
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {applyToAll ? `Your changes save to every copy (${batchCount} people).` : 'Only this person’s copy will change.'}
              </p>
            </div>
            <Switch checked={applyToAll} onCheckedChange={setApplyToAll} />
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="t-title">Work</Label>
          <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" className="bg-background/50" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-due">Due date {dueLocked ? '(locked)' : '(optional)'}</Label>
          {/* Creating: can't set a deadline in the past. EDITING: any date back to
              go-live is allowed — correcting a wrong due date (even to an earlier day)
              is exactly what re-prices the task's points. Once the work is ASSIGNED the
              date is frozen for everyone but the owner tier (see dueLocked). */}
          <DatePicker
            id="t-due"
            value={dueYMD}
            min={task ? APP_LIVE_YMD : new Date().toISOString().slice(0, 10)}
            onChange={setDueYMD}
            dayBlock={dayBlock}
            disabled={dueLocked}
            clearable
            className="bg-background/50"
          />
          {dueLocked ? (
            <p className="text-xs text-muted-foreground">
              The deadline is fixed once work is assigned. Only a CEO or President can change it.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-notes">Notes (optional)</Label>
          <Textarea id="t-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Details…" className="bg-background/50" />
        </div>

        {/* Approval gate for a delegated task. */}
        {isAssignedByMe ? (
          <div className="flex items-start justify-between gap-3 rounded-xl bg-primary/[0.05] p-3 ring-1 ring-primary/15">
            <div className="min-w-0">
              <Label className="flex items-center gap-1.5"><ThumbsUp className="size-3.5" /> Require my approval</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {requiresApproval ? 'They submit it, and it’s done only after you approve.' : 'Off — their “done” closes it immediately.'}
              </p>
            </div>
            <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} />
          </div>
        ) : null}

        {/* Tagging. On a personal task it means "also working on this" — whoever finishes
            it finishes it for everyone. On delegated work it means "keep them in the
            loop": the assignee does the job, the tagged people just see it.
            The person it is ASSIGNED to is never offered here — they already have it. */}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            <Users className="size-3.5" />
            {isAssignedByMe ? 'Tag people (optional)' : 'Also working on this (optional)'}
          </Label>
          {(() => {
            const options = taggablePeople.filter((p) => !isAssignedByMe || !assignees.includes(p.id));
            return options.length ? (
              <div className="flex flex-wrap gap-1.5">
                {options.map((p) => {
                  const on = collaborators.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleCollab(p.id)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors',
                        on ? 'bg-primary/12 text-primary ring-primary/25' : 'bg-muted/40 text-muted-foreground ring-border hover:text-foreground',
                      )}
                    >
                      {on ? <Check className="size-3" /> : null}
                      {p.name}
                      {p.designation ? <span className="opacity-60">· {p.designation}</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No one else to tag.</p>
            );
          })()}
          {collaborators.length ? (
            <p className="text-xs text-muted-foreground">
              {isAssignedByMe
                ? `${collaborators.length} tagged — it shows under “Shared with me” for them, on every copy. They don’t have to do it.`
                : `Shows under “Shared with me” for ${collaborators.length} teammate${collaborators.length > 1 ? 's' : ''}.`}
            </p>
          ) : null}
        </div>
      </div>
    </AppDialog>
  );
}
