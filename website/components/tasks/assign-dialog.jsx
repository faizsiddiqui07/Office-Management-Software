'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, UserRoundPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function AssignDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [assignTo, setAssignTo] = React.useState([]); // ids of people to assign to
  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [dueYMD, setDueYMD] = React.useState('');

  const { data } = useQuery({ queryKey: ['tasks', 'assignable'], queryFn: () => api.get('/tasks/assignable'), enabled: open });
  const users = data?.users ?? [];

  React.useEffect(() => {
    if (open) {
      setAssignTo([]);
      setTitle('');
      setNotes('');
      setDueYMD('');
    }
  }, [open]);

  const toggle = (id) => setAssignTo((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allIds = users.map((u) => u.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => assignTo.includes(id));
  const toggleAll = () => setAssignTo(allSelected ? [] : allIds);

  const mut = useMutation({
    mutationFn: () => api.post('/tasks', { assignTo, title, notes, dueYMD }),
    onSuccess: (res) => {
      const n = res?.count ?? assignTo.length;
      toast.success(n > 1 ? `Task assigned to ${n} people` : 'Task assigned');
      qc.invalidateQueries({ queryKey: ['tasks'] });
      setOpen(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not assign the task'),
  });

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
        <Button variant="outline" className="w-full sm:w-auto">
          <UserRoundPlus className="size-4" /> Assign work
        </Button>
      }
      title="Assign work"
      description="Give a task to one or more people below you — it shows up in each of their to-dos instantly. When anyone marks it done, it’s done for everyone (and only they can reopen it)."
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
                ? `Goes to ${assignTo.length} people — when anyone marks it done, it’s done for everyone.`
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
          <Input id="a-due" type="date" value={dueYMD} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDueYMD(e.target.value)} className="bg-background/50" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-notes">Notes (optional)</Label>
          <Textarea id="a-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Details…" className="bg-background/50" />
        </div>
      </div>
    </AppDialog>
  );
}
