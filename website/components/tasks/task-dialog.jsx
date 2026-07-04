'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Plus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function TaskDialog({ task, open: openProp, onOpenChange }) {
  const isEdit = !!task;
  const qc = useQueryClient();
  const { user } = useAuth();
  const [openInternal, setOpenInternal] = React.useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = onOpenChange || setOpenInternal;

  // Only people who may delegate work can tag teammates onto a shared task.
  const ta = user?.taskAssign || {};
  const canTag = ta.mode === 'ALL' || (ta.mode === 'SELECTED' && (ta.users || []).length > 0);

  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [dueYMD, setDueYMD] = React.useState('');
  const [collaborators, setCollaborators] = React.useState([]); // tagged teammate ids

  React.useEffect(() => {
    if (!open) return;
    setTitle(task?.title || '');
    setNotes(task?.notes || '');
    setDueYMD(task?.dueYMD || '');
    setCollaborators((task?.collaborators || []).map((c) => c.id).filter(Boolean));
  }, [open, task]);

  const { data: assignData } = useQuery({
    queryKey: ['tasks', 'assignable'],
    queryFn: () => api.get('/tasks/assignable'),
    enabled: open && canTag,
  });
  const people = assignData?.users ?? [];

  const toggle = (id) => setCollaborators((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const mut = useMutation({
    mutationFn: () => {
      const body = { title, notes, dueYMD };
      if (canTag) body.collaborators = collaborators;
      return isEdit ? api.patch(`/tasks/${task.id}`, body) : api.post('/tasks', body);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Task updated' : 'Task added');
      qc.invalidateQueries({ queryKey: ['tasks'] });
      setOpen(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not save the task'),
  });

  const submit = () => {
    if (!title.trim()) return toast.error('Add the work');
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
            {mut.isPending ? 'Saving…' : isEdit ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 py-2">
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

        {/* Tag teammates who are also working on this — it stays in your to-do AND
            shows in theirs (whoever finishes it, it's done for everyone). */}
        {canTag ? (
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Users className="size-3.5" /> Also working on this (optional)
            </Label>
            {people.length ? (
              <div className="flex flex-wrap gap-1.5">
                {people.map((p) => {
                  const on = collaborators.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggle(p.id)}
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
