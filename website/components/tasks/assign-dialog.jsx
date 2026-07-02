'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserRoundPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function AssignDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [assignTo, setAssignTo] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [dueYMD, setDueYMD] = React.useState('');

  const { data } = useQuery({ queryKey: ['tasks', 'assignable'], queryFn: () => api.get('/tasks/assignable'), enabled: open });
  const users = data?.users ?? [];

  React.useEffect(() => {
    if (open) {
      setAssignTo('');
      setTitle('');
      setNotes('');
      setDueYMD('');
    }
  }, [open]);

  const mut = useMutation({
    mutationFn: () => api.post('/tasks', { assignTo, title, notes, dueYMD }),
    onSuccess: () => {
      toast.success('Task assigned');
      qc.invalidateQueries({ queryKey: ['tasks'] });
      setOpen(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not assign the task'),
  });

  const submit = () => {
    if (!assignTo) return toast.error('Pick a person');
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
      description="Give a task to someone below you — it shows up in their to-do instantly, and you’ll see when it’s done."
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
          <Label htmlFor="a-user">Assign to</Label>
          <Select value={assignTo} onValueChange={setAssignTo}>
            <SelectTrigger id="a-user" className="w-full bg-background/50">
              <SelectValue placeholder="Select a person…" />
            </SelectTrigger>
            <SelectContent>
              {users.length ? (
                users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                    {u.designation ? ` · ${u.designation}` : ''}
                  </SelectItem>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-muted-foreground">No one below you to assign to.</div>
              )}
            </SelectContent>
          </Select>
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
