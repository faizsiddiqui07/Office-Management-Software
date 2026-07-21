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
  const toggleAssignee = (id) => setAssignees((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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
      } else {
        // Anyone can say who's working with them — tagging isn't handing out work.
        body.collaborators = collaborators;
      }
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
          <Label htmlFor="t-due">Due date (optional)</Label>
          <Input id="t-due" type="date" value={dueYMD} min={dueYMD || new Date().toISOString().slice(0, 10)} onChange={(e) => setDueYMD(e.target.value)} className="bg-background/50" />
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

        {/* Tag teammates onto a personal task (whoever finishes it, it's done for everyone). */}
        {!isAssignedByMe ? (
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Users className="size-3.5" /> Also working on this (optional)
            </Label>
            {taggablePeople.length ? (
              <div className="flex flex-wrap gap-1.5">
                {taggablePeople.map((p) => {
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
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No teammates available to tag.</p>
            )}
            {collaborators.length ? (
              <p className="text-xs text-muted-foreground">Shows in {collaborators.length} teammate{collaborators.length > 1 ? 's' : ''}’ “Assigned to me”.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}
