'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, ThumbsUp, UserRoundPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

export function AssignDialog() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [assignTo, setAssignTo] = React.useState([]); // ids of people to assign to
  const [collaborators, setCollaborators] = React.useState([]); // tagged (for awareness — anyone)
  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [dueYMD, setDueYMD] = React.useState('');
  const [requiresApproval, setRequiresApproval] = React.useState(false);

  const { data } = useQuery({ queryKey: ['tasks', 'assignable'], queryFn: () => api.get('/tasks/assignable'), enabled: open });
  const users = data?.users ?? [];
  // Everyone in the office — a colleague you tag is just being kept in the loop, so
  // this includes leadership, unlike the "assign to" list which is only people below you.
  const taggable = data?.taggable ?? [];

  React.useEffect(() => {
    if (open) {
      setAssignTo([]);
      setCollaborators([]);
      setTitle('');
      setNotes('');
      setDueYMD('');
      setRequiresApproval(false);
    }
  }, [open]);

  const toggle = (id) =>
    setAssignTo((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // Giving someone the work stops them being a bystander on it — drop the tag so the
      // count below matches the chips, and matches what the server will save.
      setCollaborators((tags) => tags.filter((x) => x !== id));
      return [...prev, id];
    });
  const toggleCollab = (id) => setCollaborators((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allIds = users.map((u) => u.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => assignTo.includes(id));
  const toggleAll = () => {
    if (allSelected) return setAssignTo([]);
    setCollaborators((tags) => tags.filter((x) => !allIds.includes(x)));
    setAssignTo(allIds);
  };

  const mut = useMutation({
    mutationFn: () => api.post('/tasks', { assignTo, collaborators, title, notes, dueYMD, requiresApproval }),
    onSuccess: (res) => {
      const n = res?.count ?? assignTo.length;
      toast.success(n > 1 ? `Task assigned to ${n} people` : 'Task assigned');
      qc.invalidateQueries({ queryKey: ['tasks'] });
      setOpen(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not assign the task'),
  });

  // ── Will this task count for points? ────────────────────────────────────────
  // Two rules decide it, and both are invisible unless we say so here: the work only
  // counts when the CEO & President can see it (they assigned it, or one of them is
  // tagged), and there has to be a due date to be on time against. An owner-tier
  // assigner satisfies the first rule by assigning, so they never see that half.
  const ownerTagged = collaborators.some((id) => taggable.find((p) => p.id === id)?.isOwner);
  const needsOwnerTag = !me?.isOwner && !ownerTagged;
  const needsDueDate = !dueYMD;
  const showPointsWarning = assignTo.length > 0 && (needsOwnerTag || needsDueDate);

  const submit = () => {
    if (!assignTo.length) return toast.error('Pick at least one person');
    if (!title.trim()) return toast.error('Add the work');
    mut.mutate();
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        // Solid yellow, same weight as the plain "Add task" button, so "hand work to
        // someone" reads as a distinct, deliberate action rather than a secondary one.
        <Button className="w-full bg-warning text-warning-foreground hover:bg-warning/90 sm:w-auto">
          <UserRoundPlus className="size-4" /> Assign work
        </Button>
      }
      title="Assign work"
      description="Give a task to one or more people below you — it shows up in each of their to-dos instantly. Everyone completes their own copy."
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending}>
            {mut.isPending ? 'Assigning…' : 'Assign'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="flex items-center gap-1.5">
              <Users className="size-3.5" /> Assign to
            </Label>
            {users.length > 1 ? (
              <button type="button" onClick={toggleAll} className="text-xs font-medium text-primary hover:underline">
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            ) : null}
          </div>
          {users.length ? (
            <div className="flex flex-wrap gap-1.5">
              {users.map((u) => {
                const on = assignTo.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggle(u.id)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors',
                      on ? 'bg-primary/12 text-primary ring-primary/25' : 'bg-muted/40 text-muted-foreground ring-border hover:text-foreground',
                    )}
                  >
                    {on ? <Check className="size-3" /> : null}
                    {u.name}
                    {u.designation ? <span className="opacity-60">· {u.designation}</span> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No one below you to assign to.</p>
          )}
          {assignTo.length ? (
            <p className="text-xs text-muted-foreground">
              {assignTo.length > 1
                ? `Goes to ${assignTo.length} people — each completes their own copy, and everyone can see who's done.`
                : 'Goes to 1 person.'}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-title">Work</Label>
          <Input id="a-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What should they do?" className="bg-background/50" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-due">Due date (optional)</Label>
          <DatePicker id="a-due" value={dueYMD} min={new Date().toISOString().slice(0, 10)} onChange={setDueYMD} clearable className="bg-background/50" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-notes">Notes (optional)</Label>
          <Textarea id="a-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Details…" className="bg-background/50" />
        </div>

        {/* Tag anyone in the office to keep them in the loop — it shows under "Shared with
            me" for them, and the assignee is the one who does it. Leadership included. */}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            <Users className="size-3.5" /> Tag people (optional)
          </Label>
          {(() => {
            const options = taggable.filter((p) => !assignTo.includes(p.id));
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
              {collaborators.length} tagged — it shows under “Shared with me” for them, but they don’t have to do it.
            </p>
          ) : null}
        </div>

        {/* Points eligibility — the two rules that quietly decide whether this work will
            score anything. Sits right under the tag picker so the fix is one tap away. */}
        {showPointsWarning ? (
          <div className="flex items-start gap-2.5 rounded-xl bg-warning/[0.08] p-3 ring-1 ring-warning/30">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">This task won’t earn any points</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {needsOwnerTag ? <li>· Tag a CEO or President above — work they can’t see stays out of the points system.</li> : null}
                {needsDueDate ? <li>· Set a due date — without a deadline there is nothing to be on time against.</li> : null}
              </ul>
              <p className="text-xs text-muted-foreground">You can still assign it — it just won’t count for or against anyone.</p>
            </div>
          </div>
        ) : null}

        {/* Approval gate — the assignee's "done" becomes a request you approve first. */}
        <div className="flex items-start justify-between gap-3 rounded-xl bg-primary/[0.05] p-3 ring-1 ring-primary/15">
          <div className="min-w-0">
            <Label className="flex items-center gap-1.5"><ThumbsUp className="size-3.5" /> Require my approval</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {requiresApproval ? 'They submit it, and it’s done only after you approve.' : 'Off — their “done” closes it immediately.'}
            </p>
          </div>
          <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} />
        </div>
      </div>
    </AppDialog>
  );
}
