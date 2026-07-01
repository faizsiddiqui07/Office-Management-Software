'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function TaskDialog({ task, open: openProp, onOpenChange }) {
  const isEdit = !!task;
  const qc = useQueryClient();
  const [openInternal, setOpenInternal] = React.useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = onOpenChange || setOpenInternal;

  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [dueYMD, setDueYMD] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setTitle(task?.title || '');
    setNotes(task?.notes || '');
    setDueYMD(task?.dueYMD || '');
  }, [open, task]);

  const mut = useMutation({
    mutationFn: () => (isEdit ? api.patch(`/tasks/${task.id}`, { title, notes, dueYMD }) : api.post('/tasks', { title, notes, dueYMD })),
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
          <Input id="t-due" type="date" value={dueYMD} onChange={(e) => setDueYMD(e.target.value)} className="bg-background/50" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-notes">Notes (optional)</Label>
          <Textarea id="t-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Details…" className="bg-background/50" />
        </div>
      </div>
    </AppDialog>
  );
}
