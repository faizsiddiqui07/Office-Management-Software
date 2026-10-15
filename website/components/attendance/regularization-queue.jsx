'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, History, Trash2, Wrench, X } from 'lucide-react';
import { api } from '@/lib/api';
import { roleName } from '@/lib/permissions';
import { GlassCard } from '@/components/glass/glass-card';
import { StatusBadge } from '@/components/glass/status-badge';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SortSelect, sortRows, byText, byTime, byYMD, thenBy } from '@/components/glass/sort-select';
import { PeriodFilter } from '@/components/glass/period-filter';
import { ALL_TIME, describePeriod, inPeriod, isPeriodActive, resolvePeriod } from '@/lib/date-period';

function fmtDate(ymd) {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtWhen(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
// Requested times are 24h "HH:mm" strings — shown as-is (24h everywhere).

/** Two-step (click → confirm) delete so a record isn't removed by accident. */
function DeleteButton({ id }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = React.useState(false);
  const del = useMutation({
    mutationFn: () => api.delete(`/regularizations/${id}`),
    onSuccess: () => {
      toast.success('Correction record deleted');
      qc.invalidateQueries({ queryKey: ['regularizations'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not delete'),
  });

  if (!confirming) {
    return (
      <Button variant="ghost" className="h-10 text-destructive sm:h-8" onClick={() => setConfirming(true)}>
        <Trash2 className="size-4" /> Delete
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Delete?</span>
      <Button variant="ghost" className="h-10 sm:h-8" onClick={() => setConfirming(false)} disabled={del.isPending}>
        Cancel
      </Button>
      <Button variant="destructive" className="h-10 sm:h-8" onClick={() => del.mutate()} disabled={del.isPending}>
        <Trash2 className="size-4" /> Delete
      </Button>
    </div>
  );
}

function RequestDetails({ r }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-sm font-medium">
        {r.user?.name} <span className="text-xs font-normal text-muted-foreground">· {roleName(r.user)}</span>
      </p>
      <p className="text-sm">
        {fmtDate(r.dateYMD)} —{' '}
        {[r.requestedCheckIn && `In ${r.requestedCheckIn}`, r.requestedCheckOut && `Out ${r.requestedCheckOut}`]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="text-xs text-muted-foreground">{r.reason}</p>
    </div>
  );
}

function PendingList() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['regularizations', 'pending'], queryFn: () => api.get('/regularizations') });
  const requests = data?.requests ?? [];
  // The window is on the day the correction is ABOUT (dateYMD), not the day it was
  // raised: "last month's corrections" means the days somebody is fixing.
  const [period, setPeriod] = React.useState(ALL_TIME);
  const range = resolvePeriod(period);
  const rows = isPeriodActive(range) ? requests.filter((r) => inPeriod(r.dateYMD, range)) : requests;

  const decide = useMutation({
    mutationFn: ({ id, decision }) => api.post(`/regularizations/${id}/decide`, { decision }),
    onSuccess: (_d, v) => {
      toast.success(v.decision === 'APPROVED' ? 'Approved — attendance updated' : 'Request rejected');
      qc.invalidateQueries({ queryKey: ['regularizations'] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
      // A decision can turn on whether the day is on leave, so anything showing leave
      // has to re-read rather than keep a copy from before the decision.
      qc.invalidateQueries({ queryKey: ['leaves'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not decide'),
  });

  if (isLoading) return <LoadingState label="Loading correction requests…" />;
  if (!requests.length)
    return <EmptyState icon={Wrench} title="No pending corrections" description="Attendance correction requests will appear here for your review." />;

  return (
    <div className="space-y-3">
      <PeriodFilter value={period} onChange={setPeriod} />
      {/* "7 of 23" rather than just "7": without the total, a window that hides
          most of the queue looks like an empty queue. */}
      <p className="text-xs text-muted-foreground">
        {isPeriodActive(range)
          ? `${rows.length} of ${requests.length} pending · ${describePeriod(range)}`
          : `${requests.length} pending ${requests.length === 1 ? 'request' : 'requests'}`}
      </p>
      {!rows.length ? (
        <GlassCard className="p-6 text-center text-sm text-muted-foreground">
          No pending correction is dated in this window — try a wider one.
        </GlassCard>
      ) : null}
      {rows.map((r) => (
        <GlassCard key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <RequestDetails r={r} />
          <div className="flex shrink-0 flex-wrap items-center gap-3 sm:gap-2">
            <Button variant="outline" className="h-10 sm:h-8" onClick={() => decide.mutate({ id: r.id, decision: 'REJECTED' })} disabled={decide.isPending}>
              <X className="size-4" /> Reject
            </Button>
            <Button className="h-10 sm:h-8" onClick={() => decide.mutate({ id: r.id, decision: 'APPROVED' })} disabled={decide.isPending}>
              <Check className="size-4" /> Approve
            </Button>
            <DeleteButton id={r.id} />
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

/**
 * Two different dates live on one row and people look for both: the day the
 * correction is ABOUT (dateYMD) and the day somebody decided it (decidedAt).
 * "Last week's decisions" and "corrections for last week" are different
 * questions, so each gets its own pair of options.
 *
 * Every option ends in a timestamp tie-break, so rows that match on the visible
 * key still land in a fixed order instead of shuffling between renders.
 */
const HISTORY_SORTS = [
  { value: 'decided_desc', label: 'Decided · newest first', compare: thenBy(byTime((r) => r.decidedAt), byYMD((r) => r.dateYMD)) },
  { value: 'decided_asc', label: 'Decided · oldest first', compare: thenBy(byTime((r) => r.decidedAt, 'asc'), byYMD((r) => r.dateYMD, 'asc')) },
  { value: 'date_desc', label: 'Correction date · newest first', compare: thenBy(byYMD((r) => r.dateYMD), byTime((r) => r.decidedAt)) },
  { value: 'date_asc', label: 'Correction date · oldest first', compare: thenBy(byYMD((r) => r.dateYMD, 'asc'), byTime((r) => r.decidedAt)) },
  { value: 'name_asc', label: 'Employee A–Z', compare: thenBy(byText((r) => r.user?.name), byTime((r) => r.decidedAt)) },
  {
    value: 'approved_first',
    label: 'Approved first',
    compare: thenBy((a, b) => (a.status === 'APPROVED' ? 0 : 1) - (b.status === 'APPROVED' ? 0 : 1), byTime((r) => r.decidedAt)),
  },
];

function HistoryList() {
  const { data, isLoading } = useQuery({ queryKey: ['regularizations', 'history'], queryFn: () => api.get('/regularizations/history') });
  const requests = data?.requests ?? [];
  // Starts on the order the server already sends (newest decision first), so the
  // control begins by describing what is on screen rather than changing it.
  const [sort, setSort] = React.useState('decided_desc');
  // Windowed on the correction's own date, exactly like the pending list — one
  // meaning of "this month" across both tabs. Whoever wants the DECISION date has
  // it in the sort list.
  const [period, setPeriod] = React.useState(ALL_TIME);
  const range = resolvePeriod(period);
  const inWindow = isPeriodActive(range) ? requests.filter((r) => inPeriod(r.dateYMD, range)) : requests;
  const rows = sortRows(inWindow, HISTORY_SORTS, sort);

  if (isLoading) return <LoadingState label="Loading history…" />;
  if (!requests.length)
    return <EmptyState icon={History} title="No decided corrections yet" description="Approved and rejected corrections will show here." />;

  return (
    <div className="space-y-3">
      <PeriodFilter value={period} onChange={setPeriod} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {isPeriodActive(range)
            ? `${rows.length} of ${requests.length} decided · ${describePeriod(range)}`
            : `${requests.length} decided ${requests.length === 1 ? 'correction' : 'corrections'}`}
        </p>
        <SortSelect value={sort} onChange={setSort} options={HISTORY_SORTS} ariaLabel="Sort corrections" />
      </div>
      {!rows.length ? (
        <GlassCard className="p-6 text-center text-sm text-muted-foreground">
          No correction is dated in this window — try a wider one.
        </GlassCard>
      ) : null}
      {rows.map((r) => (
        <GlassCard key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={r.status === 'APPROVED' ? 'success' : 'destructive'}>
                {r.status === 'APPROVED' ? 'Approved' : 'Rejected'}
              </StatusBadge>
              <span className="text-sm font-medium">{r.user?.name}</span>
              <span className="text-xs text-muted-foreground">· {roleName(r.user)}</span>
            </div>
            <p className="text-sm">
              {fmtDate(r.dateYMD)} —{' '}
              {[r.requestedCheckIn && `In ${r.requestedCheckIn}`, r.requestedCheckOut && `Out ${r.requestedCheckOut}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="text-xs text-muted-foreground">{r.reason}</p>
            {r.decidedBy?.name || r.decidedAt ? (
              <p className="text-xs text-muted-foreground">
                By {r.decidedBy?.name || '—'}
                {r.decidedAt ? ` · ${fmtWhen(r.decidedAt)}` : ''}
                {r.decisionNote ? ` · “${r.decisionNote}”` : ''}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DeleteButton id={r.id} />
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

export function RegularizationQueue() {
  return (
    <Tabs defaultValue="pending" className="space-y-4">
      <TabsList>
        <TabsTrigger value="pending">Pending</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="pending">
        <PendingList />
      </TabsContent>
      <TabsContent value="history">
        <HistoryList />
      </TabsContent>
    </Tabs>
  );
}
