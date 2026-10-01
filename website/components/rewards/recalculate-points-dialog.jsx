'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Calculator, RefreshCw, AlertTriangle, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { formatYMD } from '@/lib/leave';

/**
 * CEO & President: re-decide every attendance-derived award from the day the office went
 * live, and show exactly whose points move before anything is written.
 *
 * It exists because the automatic scans are one-shot by design: a day's punctuality is
 * judged once and a month's awards are decided once, so anything corrected AFTERWARDS — a
 * late excused to on-duty, a backdated leave approved, a regularization — never re-earns the
 * award it should have. Settings' older "Recalculate now" cannot fix those; it respects the
 * same watermarks.
 *
 * Two steps on purpose. Opening this reads and shows the plan without writing a thing; only
 * the second press applies it. The plan is fingerprinted, so if anything changes in between —
 * somebody checks in, a leave is approved — the apply refuses rather than quietly doing
 * something other than what was approved.
 */
export function RecalculatePointsDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [preview, setPreview] = React.useState(null);
  const [result, setResult] = React.useState(null);
  // Kept apart on purpose. One shared error made a failed APPLY render "couldn't check what
  // would change" over a "Try again" button wired to the preview — so the owner would read
  // the wrong thing and press the wrong button.
  const [previewError, setPreviewError] = React.useState(null);
  const [applyError, setApplyError] = React.useState(null);

  const runPreview = () => {
    setPreviewError(null);
    setApplyError(null);
    setResult(null);
    previewMut.mutate();
  };

  const previewMut = useMutation({
    mutationFn: () => api.get('/bonus/rebuild/preview'),
    onSuccess: (res) => setPreview(res),
    onError: (e) => { setPreview(null); setPreviewError(e); },
  });

  const applyMut = useMutation({
    mutationFn: () => api.post('/bonus/rebuild', { planHash: preview?.planHash }),
    onSuccess: (res) => {
      setResult(res);
      setPreview(null);
      setApplyError(null);
      toast.success(res.movedCount ? `Done — ${res.movedCount} ${res.movedCount === 1 ? 'person' : 'people'} updated` : 'Done — nothing needed changing');
      // Every place a points figure is rendered. Missing one leaves the owner looking at the
      // old number on the page behind this dialog.
      for (const key of [['bonus'], ['dashboard'], ['users'], ['reports'], ['attendance'], ['activity']]) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
    onError: (e) => {
      // The apply may have half-run, or run and lost its response. Never leave Apply armed:
      // the only way back to it is a fresh read of what the ledger says NOW.
      setPreview(null);
      setApplyError(e);
    },
  });

  React.useEffect(() => {
    if (open) runPreview();
    else { setPreview(null); setResult(null); setPreviewError(null); setApplyError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const busy = previewMut.isPending || applyMut.isPending;
  const canApply = !!preview && !preview.clean && !busy;

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <Calculator className="size-4" /> Recalculate points
        </Button>
      }
      title="Recalculate points"
      description="Re-checks every streak, perfect-attendance month, late and absent mark against the attendance sheet, all the way back to the day the office started. Nothing is written until you confirm."
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
          {result ? null : (
            <Button onClick={() => applyMut.mutate()} disabled={!canApply}>
              <RefreshCw className={`size-4${applyMut.isPending ? ' animate-spin' : ''}`} />
              {applyMut.isPending ? 'Applying…' : 'Apply changes'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4 py-2">
        {previewMut.isPending ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Checking what would change…</p>
        ) : null}

        {previewError ? (
          <div className="space-y-2 rounded-xl bg-destructive/[0.07] p-3 text-sm ring-1 ring-destructive/20">
            <p className="font-medium text-destructive">Couldn’t check what would change</p>
            <p className="text-xs text-muted-foreground">{previewError.message}</p>
            <Button size="sm" variant="outline" onClick={runPreview}>Check again</Button>
          </div>
        ) : null}

        {applyError ? (
          <div className="space-y-2 rounded-xl bg-destructive/[0.07] p-3 text-sm ring-1 ring-destructive/20">
            <p className="font-medium text-destructive">
              {applyError.code === 'PLAN_CHANGED' ? 'The figures moved while you were looking' : 'The update didn’t finish'}
            </p>
            <p className="text-xs text-muted-foreground">
              {applyError.code === 'PLAN_CHANGED'
                ? 'Somebody checked in or a leave was approved since you opened this. Check the new figures before applying.'
                : `${applyError.message} Some of it may have been applied — check the new figures before trying again.`}
            </p>
            <Button size="sm" variant="outline" onClick={runPreview}>Check again</Button>
          </div>
        ) : null}

        {preview?.busy ? (
          <p className="rounded-xl bg-amber-500/[0.08] p-3 text-xs text-muted-foreground ring-1 ring-amber-500/20">
            <AlertTriangle className="mr-1 inline size-3.5 text-amber-500" />
            Another recalculation is running right now. Wait for it to finish before applying.
          </p>
        ) : null}

        {preview && preview.clean ? (
          <div className="rounded-xl bg-primary/[0.06] p-4 text-center text-sm ring-1 ring-primary/15">
            <Check className="mx-auto mb-1 size-5 text-primary" />
            <p className="font-medium text-primary">Everything already matches the rules</p>
            <p className="mt-1 text-xs text-muted-foreground">Nobody’s points would change. Nothing to apply.</p>
          </div>
        ) : null}

        {preview && !preview.clean ? <PlanTable plan={preview} /> : null}

        {result ? (
          <>
            <div className="rounded-xl bg-primary/[0.06] p-3 text-sm ring-1 ring-primary/15">
              <p className="font-medium text-primary">
                {result.movedCount
                  ? `Updated ${result.movedCount} ${result.movedCount === 1 ? 'person' : 'people'} · ${result.totalDelta > 0 ? '+' : ''}${result.totalDelta} points`
                  : 'Nothing needed changing'}
              </p>
              {result.verified ? (
                <p className="mt-0.5 text-xs text-muted-foreground">Checked afterwards — the ledger now matches the rules exactly.</p>
              ) : (
                <p className="mt-0.5 text-xs text-destructive">
                  Some entries still don’t match the rules. Run this again, and if it says the same thing, don’t apply anything else until it’s looked at.
                </p>
              )}
            </div>
            {result.rows?.length ? <PlanTable plan={result} /> : null}
          </>
        ) : null}

        {preview?.lastRebuildAt ? (
          <p className="text-xs text-muted-foreground">
            Last run {formatYMD(String(preview.lastRebuildAt).slice(0, 10))}
            {preview.lastRebuildBy ? ` by ${preview.lastRebuildBy}` : ''}.
          </p>
        ) : null}
      </div>
    </AppDialog>
  );
}

/** Who moves, by how much, and which awards did it. */
function PlanTable({ plan }) {
  const moved = (plan.rows || []).filter((r) => r.delta !== 0);
  const datesOnly = (plan.rows || []).filter((r) => r.delta === 0);
  return (
    <div className="space-y-3">
      {moved.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {moved.length} {moved.length === 1 ? 'person' : 'people'} · {plan.totalDelta > 0 ? '+' : ''}{plan.totalDelta} points in total
          </p>
          {moved.map((r) => <PersonRow key={r.userId} row={r} />)}
        </div>
      ) : null}

      {/* Same total, different days. Worth showing: these awards will be dated differently on
          the Rewards page afterwards, and somebody would otherwise notice and wonder. */}
      {datesOnly.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Same total, award dates change
          </p>
          {datesOnly.map((r) => <PersonRow key={r.userId} row={r} />)}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Covers {plan.months?.length || 0} finished {plan.months?.length === 1 ? 'month' : 'months'} and {plan.rosterCount} people on the attendance roster.
        Task points, overtime and anything given by hand are not touched.
      </p>
    </div>
  );
}

function PersonRow({ row }) {
  return (
    <div className="rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{row.name}</span>
        <span className="text-sm tabular-nums">
          <span className="text-muted-foreground">{row.before}</span>
          <span className="mx-1 text-muted-foreground">→</span>
          <span className="font-semibold">{row.after}</span>
          {row.delta !== 0 ? (
            <span className={`ml-2 font-medium ${row.delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
              {row.delta > 0 ? '+' : ''}{row.delta}
            </span>
          ) : null}
        </span>
      </div>
      <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
        {row.changes.map((c, i) => (
          <li key={`${c.source}-${c.on}-${i}`} className="flex items-baseline justify-between gap-2">
            <span>
              {c.kind === 'add' ? 'Added' : c.kind === 'remove' ? 'Removed' : 'Changed'} · {c.what} · {c.on}
            </span>
            <span className="tabular-nums">{c.points > 0 ? '+' : ''}{c.points}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
