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

/** A Select can't hold an empty-string value, so "nobody" needs a sentinel. */
const NOBODY = '__none__';

/**
 * Permanently remove an account, and decide who picks up the work it had handed out.
 *
 * Deleting used to strip the assigner off those tasks and stop there. They stayed in
 * their assignees' lists answering to nobody — no one to chase them, approve a
 * submission, or close them, and (because the assigner check is what stops an assignee
 * editing their own deadline) nobody able to touch them at all. This asks the one
 * question that fixes that, at the only moment anyone is thinking about it.
 *
 * What it does NOT move is the points. Those stay exactly as they were the moment the
 * account went: naming a successor changes who is responsible, never what anyone earned.
 */
export function DeleteUserDialog({ user: target, open, onOpenChange }) {
  const qc = useQueryClient();
  const [heir, setHeir] = React.useState(NOBODY);

  React.useEffect(() => {
    if (open) setHeir(NOBODY);
  }, [open, target?.id]);

  const {
    data: exit,
    isLoading: exitLoading,
    isError: exitError,
  } = useQuery({
    queryKey: ['user-exit', target?.id],
    queryFn: () => api.get(`/users/${target.id}/exit-summary`),
    enabled: !!open && !!target?.id,
  });

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users'),
    enabled: !!open,
  });

  // Only people who can actually delegate — the server refuses anyone else, and naming
  // them would put a name on a task they still could not reassign.
  const candidates = (usersData?.users ?? []).filter(
    (u) =>
      u.id !== target?.id &&
      u.isActive !== false &&
      (u.taskAssign?.mode === 'ALL' || (u.taskAssign?.mode === 'SELECTED' && (u.taskAssign?.users || []).length > 0)),
  );

  const delegated = exit?.openTasksDelegated ?? 0;

  const mut = useMutation({
    mutationFn: () =>
      api.delete(`/users/${target.id}`, { body: heir === NOBODY ? {} : { reassignTasksTo: heir } }),
    onSuccess: (res) => {
      toast.success(
        res?.handedOver
          ? `User deleted — ${res.handedOver} open ${res.handedOver === 1 ? 'task is' : 'tasks are'} now with ${res.handedOverTo}`
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
        { label: 'Work they delegated, still open', value: delegated, note: delegated ? 'needs someone responsible' : '' },
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
          <Button
            variant="destructive"
            onClick={() => mut.mutate()}
            // Blocked until we know what is still open against the account. Deleting on a
            // failed summary is how the handover question silently never gets asked.
            disabled={mut.isPending || exitLoading || exitError}
          >
            {mut.isPending ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
          {exitLoading ? (
            <p className="text-sm text-muted-foreground">Checking what’s still open…</p>
          ) : exitError ? (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                Couldn’t check what’s still open against this account, so deleting is blocked — otherwise
                their unfinished work could be left with nobody responsible for it. Close this and try again.
              </span>
            </p>
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
              Who becomes responsible for the {delegated} open {delegated === 1 ? 'task' : 'tasks'} they delegated?
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
                  {delegated === 1 ? 'That task stays' : 'Those tasks stay'} with{' '}
                  {delegated === 1 ? 'its assignee' : 'their assignees'} answering to nobody: no one can approve a
                  submission on {delegated === 1 ? 'it' : 'them'}, change the deadline, or close{' '}
                  {delegated === 1 ? 'it' : 'them'} out. The assignee can still finish{' '}
                  {delegated === 1 ? 'it' : 'them'}.
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                They’ll appear under “Assigned by me” for that person, who can then approve, edit or close them.
                Finished work is left alone, and nobody’s points change either way.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}
