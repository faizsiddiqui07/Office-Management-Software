'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Forward, ThumbsUp } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

/**
 * Pass work you were given further down. You keep your copy — you're still answerable
 * for it to whoever gave it to you — and it closes once the person you forwarded to
 * finishes and any approvals along the way are satisfied.
 */
export function ForwardDialog({ task, open, onOpenChange }) {
  const qc = useQueryClient();
  const [assignTo, setAssignTo] = React.useState('');
  const [requiresApproval, setRequiresApproval] = React.useState(false);
  const [notes, setNotes] = React.useState('');

  const { data } = useQuery({
    queryKey: ['tasks', 'assignable'],
    queryFn: () => api.get('/tasks/assignable'),
    enabled: open,
  });
  const people = data?.users ?? []; // forwarding is delegating — same access as assigning

  React.useEffect(() => {
    if (!open) return;
    setAssignTo('');
    setRequiresApproval(false);
    setNotes(task?.notes || '');
  }, [open, task]);

  const mut = useMutation({
    mutationFn: () => api.post(`/tasks/${task.id}/forward`, { assignTo, requiresApproval, notes }),
    onSuccess: () => {
      toast.success('Task forwarded');
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not forward the task'),
  });

  const from = task?.originalAssignedBy?.name || task?.assignedBy?.name;

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Forward this task"
      description={from ? `Originally from ${from} — it stays in your list until it's finished.` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!assignTo) return toast.error('Pick a person');
              mut.mutate();
            }}
            disabled={mut.isPending}
          >
            <Forward className="size-4" /> {mut.isPending ? 'Forwarding…' : 'Forward'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label>Forward to</Label>
          {people.length ? (
            <div className="flex flex-wrap gap-1.5">
              {people.map((p) => {
                const on = assignTo === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setAssignTo(on ? '' : p.id)}
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
            <p className="text-xs text-muted-foreground">No one below you to forward to.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fw-notes">Notes for them (optional)</Label>
          <Textarea id="fw-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything they should know…" className="bg-background/50" />
        </div>

        <div className="flex items-start justify-between gap-3 rounded-xl bg-primary/[0.05] p-3 ring-1 ring-primary/15">
          <div className="min-w-0">
            <Label className="flex items-center gap-1.5"><ThumbsUp className="size-3.5" /> Require my approval</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {requiresApproval
                ? 'They submit it, and it comes to you before it counts as done.'
                : 'Off — their “done” closes it, and yours follows automatically.'}
            </p>
          </div>
          <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} />
        </div>

        <p className="text-xs text-muted-foreground">
          Your own copy stays until this is finished — {from ? `${from} still sees it with you.` : 'whoever gave it to you still sees it with you.'}
        </p>
      </div>
    </AppDialog>
  );
}
