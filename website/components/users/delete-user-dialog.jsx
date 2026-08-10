'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/expense';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Sentinel for "nobody" — a Select can't hold an empty-string value. */
const NOBODY = '__none__';

/**
 * Permanently remove an account, and decide what happens to the work it had handed
 * out that is still open.
 *
 * Deleting used to strip the assigner off those tasks and stop there. They stayed in
 * their assignees' lists with nobody named against them: no one to chase them, no one
 * to reopen or close them, and nothing in the data that told them apart from a
 * personal to-do. This asks the one question that fixes that — who takes them over —
 * at the only moment anyone is thinking about it.
 */
export function DeleteUserDialog({ user: target, open, onOpenChange }) {
  const qc = useQueryClient();
  const [heir, setHeir] = React.useState(NOBODY);

  React.useEffect(() => {
    if (open) setHeir(NOBODY);
  }, [open, target?.id]);

  // What is still open against this account. Same summary the Edit dialog shows before
  // deactivation — here it is the last chance to act on it.
  const { data: exit, isLoading: exitLoading } = useQuery({
    queryKey: ['user-exit', target?.id],
    queryFn: () => api.get(`/users/${target.id}/exit-summary`),
    enabled: !!open && !!target?.id,
  });

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users'),
    enabled: !!open,
  });

  // Only people who can actually delegate. Naming anyone else would put a name on the
  // task that still cannot reassign, chase or close it — the backend refuses it too.
  const candidates = (usersData?.users ?? []).filter(
    (u) =>
      u.id !== target?.id &&
      u.isActive !== false &&
      (u.taskAssign?.mode === 'ALL' || (u.taskAssign?.mode === 'SELECTED' && (u.taskAssign?.users || []).length > 0)),
  );

  const delegated = exit?.openTasksDelegated ?? 0;
  const mut = useMutation({
    mutationFn: () =>
      api.delete(`/users/${target.id}`, {
        body: heir === NOBODY ? {} : { reassignTasksTo: heir },
      }),
    onSuccess: (res) => {
      toast.success(
        res?.handedOver
          ? `User deleted — ${res.handedOver} open ${res.handedOver === 1 ? 'task' : 'tasks'} moved to ${res.handedOverTo}`
          : 'User deleted',
      );
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not delete user'),
  });

  const rows = exit
    ? [
        { label: 'Their own open tasks', value: exit.openTasksOwned, note: 'deleted with the account' },
        { label: 'Work they delegated, still open', value: delegated, note: delegated ? 'needs a new owner' : '' },
        { label: 'Pending leave requests', value: exit.pendingLeaves, note: 'deleted with the account' },
        {
          label: 'Dues',
          value:
            exit.duesPending > 0
              ? formatMoney(exit.duesPending)
              : exit.duesAdvance > 0
                ? `${formatMoney(exit.duesAdvance)} advance`
                : 'None',
          note: exit.duesPending > 0 ? 'settle before deleting' : '',
        },
        { label: 'Points this month', value: exit.pointsThisMonth, note: '' },
      ]
    : [];

  return (
    <AppDialog
      open={!!open}
      onOpenChange={(o) => !o && onOpenChange(false)}
      title={`Delete ${target?.name || 'this user'}?`}
      description="This permanently removes the account and their attendance, leave, task and dues records. Content they authored and the activity log are kept. This can't be undone."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => mut.mutate()} disabled={mut.isPending || exitLoading}>
            {mut.isPending ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
          {exitLoading ? (
            <p className="text-sm text-muted-foreground">Checking what’s still open…</p>
          ) : (
            <dl className="space-y-1.5">
              {rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-3 text-sm">
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd className="flex items-baseline gap-2">
                    {r.note ? <span className="text-xs text-muted-foreground">{r.note}</span> : null}
                    <span className="font-medium tabular-nums">{r.value}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {delegated > 0 ? (
          <div className="space-y-2">
            <Label htmlFor="reassign">
              Who takes over the {delegated} open {delegated === 1 ? 'task' : 'tasks'} they delegated?
            </Label>
            <Select value={heir} onValueChange={setHeir}>
              <SelectTrigger id="reassign">
                <SelectValue placeholder="Choose a person" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOBODY}>Nobody — leave them unassigned</SelectItem>
                {candidates.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                    {u.designation ? ` · ${u.designation}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {heir === NOBODY ? (
              <p className="flex items-start gap-2 text-xs text-warning">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Those {delegated === 1 ? 'task stays' : 'tasks stay'} in {delegated === 1 ? 'its' : 'their'} assignees’
                  lists with nobody named against {delegated === 1 ? 'it' : 'them'}. Points already earned on{' '}
                  {delegated === 1 ? 'it' : 'them'} are kept, but no new ones are awarded and no further overdue
                  penalties build up.
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Finished work keeps its original history — only the {delegated} open{' '}
                {delegated === 1 ? 'task moves' : 'tasks move'}.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}
