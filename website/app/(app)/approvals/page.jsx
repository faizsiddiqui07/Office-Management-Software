'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, CheckCheck, ClipboardCheck, History, Inbox, TriangleAlert, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/glass/page-header';
import { GlassCard } from '@/components/glass/glass-card';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { StatusBadge } from '@/components/glass/status-badge';
import { Button } from '@/components/ui/button';
import { DateRange } from '@/components/ui/date-range';
import { ApprovalCard, waitingFor } from '@/components/approvals/approval-card';
import { LEAVE_TYPE_LABELS, formatRange, formatYMD } from '@/lib/leave';
import { APP_LIVE_YMD } from '@/lib/app-live';

/**
 * One kind of decision at a time.
 *
 * The first version stacked all three kinds down one page and everything blurred
 * together. Now a tab picks the kind, and BOTH halves of the screen follow it: what's
 * pending of that kind, and what you've already decided of that kind. Whatever tab
 * you're on, everything you can see is about the same thing.
 *
 * Still read-only — every decision goes to the endpoint that already owned it.
 */

const TABS = [
  { key: 'leaves', label: 'Leave', short: 'Leave', icon: CalendarDays },
  { key: 'regularizations', label: 'Attendance', short: 'Attend.', icon: Wrench },
  { key: 'tasks', label: 'Work', short: 'Work', icon: ClipboardCheck },
];

/** Ready-made history windows, plus a custom one. */
const RANGES = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_3', label: 'Last 3 months' },
  { key: 'custom', label: 'Custom' },
];

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

// One instance each, so a loading render doesn't hand every hook a brand-new object.
const NO_SECTIONS = Object.freeze({});
const NO_COUNTS = Object.freeze({ total: 0 });

function rangeFor(key, custom) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (key === 'last_month') {
    return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
  }
  if (key === 'last_3') return { from: ymd(new Date(y, m - 2, 1)), to: ymd(now) };
  if (key === 'custom') return { from: custom.from, to: custom.to };
  return { from: ymd(new Date(y, m, 1)), to: ymd(now) };
}

const TONE = { APPROVED: 'success', REJECTED: 'destructive' };
const VERB = { APPROVED: 'Approved', REJECTED: 'Rejected', SENT_BACK: 'Sent back' };

/** `decidedAt` is a plain UTC instant; read it in company time or a late-night
 *  decision lands on the day before. */
const decidedOn = (when) => (when ? ymd(new Date(when)) : '');

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState(null); // null until we know which tabs exist
  const [rangeKey, setRangeKey] = React.useState('this_month');
  const [custom, setCustom] = React.useState({ from: '', to: '' });
  const [showHistory, setShowHistory] = React.useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: () => api.get('/approvals'),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  // Shared constants, not fresh `{}` literals: a new object every render changes the
  // identity of every dep that reads it, which is what set the sidebar dots looping
  // once before. Nothing mutates these.
  const sections = data?.sections ?? NO_SECTIONS;
  const counts = data?.counts ?? NO_COUNTS;

  // The server decides. Work is a tab here for anyone the module is for, even when
  // empty — hiding it made people think the feature had never been built — but the
  // rows inside are only ever work THIS person handed out.
  const visibleTabs = React.useMemo(() => TABS.filter((t) => sections[t.key]), [sections]);

  // Land on the tab that actually needs attention, not always the first one.
  React.useEffect(() => {
    if (!data || tab) return;
    const withWork = visibleTabs.find((t) => (counts[t.key] ?? 0) > 0);
    setTab((withWork ?? visibleTabs[0])?.key ?? 'tasks');
  }, [data, tab, visibleTabs, counts]);

  const range = rangeFor(rangeKey, custom);
  const historyReady = rangeKey !== 'custom' || (!!custom.from && !!custom.to);

  const { data: history, isLoading: histLoading } = useQuery({
    queryKey: ['approvals', 'history', tab, range.from, range.to],
    queryFn: () => api.get(`/approvals/history?kind=${tab}&from=${range.from}&to=${range.to}`),
    enabled: showHistory && !!tab && historyReady,
  });

  const refreshAll = () => {
    for (const key of [['approvals'], ['leaves'], ['regularizations'], ['tasks'], ['badges'], ['attendance']]) {
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const decideLeave = useMutation({
    mutationFn: ({ id, decision, note }) => api.post(`/leaves/${id}/decision`, { decision, note }),
    onSuccess: (_r, v) => { toast.success(`Leave ${v.decision === 'APPROVE' ? 'approved' : 'rejected'}`); refreshAll(); },
    onError: (e) => toast.error(e?.message || 'Could not submit the decision'),
  });

  // Corrections take APPROVED/REJECTED; leave takes APPROVE/REJECT. Two endpoints,
  // two vocabularies, both older than this page.
  const decideFix = useMutation({
    mutationFn: ({ id, decision, note }) => api.post(`/regularizations/${id}/decide`, { decision, note }),
    onSuccess: (_r, v) => { toast.success(`Correction ${v.decision === 'APPROVED' ? 'approved' : 'rejected'}`); refreshAll(); },
    onError: (e) => toast.error(e?.message || 'Could not submit the decision'),
  });

  const decideTask = useMutation({
    mutationFn: ({ id, approve, reason }) => api.patch(`/tasks/${id}/review`, { approve, reason }),
    onSuccess: (_r, v) => { toast.success(v.approve ? 'Task approved' : 'Sent back to the assignee'); refreshAll(); },
    onError: (e) => toast.error(e?.message || 'Could not submit the decision'),
  });

  const busy = decideLeave.isPending || decideFix.isPending || decideTask.isPending;
  const rows = tab ? data?.[tab] ?? [] : [];
  const current = TABS.find((t) => t.key === tab);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Approvals"
        title="Waiting on you"
        icon={Inbox}
        description="One kind at a time — what needs your decision, and what you've already decided."
      />

      {isError && !data ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn’t load your approvals"
          description={error?.message || 'Something went wrong on the way. Check your connection and try again.'}
          action={<Button variant="outline" onClick={() => refetch()}>Try again</Button>}
        />
      ) : isLoading && !data ? (
        <LoadingState label="Gathering everything…" />
      ) : !data.allowed ? (
        // Reachable only by typing the URL — the sidebar link is already hidden.
        <EmptyState
          icon={Inbox}
          title="This page isn’t for your role"
          description="Approvals here are for leave and attendance corrections. Work you handed out is approved on the To-Do page, next to the task itself."
        />
      ) : !visibleTabs.length ? (
        <EmptyState icon={CheckCheck} title="Nothing comes to you" description="No approvals are routed to you." />
      ) : (
        <>
          {/* ── Tabs. Horizontal scroll below sm so three tabs never squash. ── */}
          <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
            <div className="inline-flex min-w-full gap-1 rounded-xl border border-border/60 bg-muted/40 p-1 sm:min-w-0">
              {visibleTabs.map((t) => {
                const n = counts[t.key] ?? 0;
                const on = tab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    aria-pressed={on}
                    className={cn(
                      'inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      on ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60 dark:bg-white/10' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <t.icon className="size-4 shrink-0" />
                    {/* "Attendance" is too wide for three tabs on a 360px phone. */}
                    <span className="hidden sm:inline">{t.label}</span>
                    <span className="sm:hidden">{t.short}</span>
                    {n ? (
                      <span className={cn('rounded-full px-1.5 text-xs font-semibold', on ? 'bg-primary/15 text-primary' : 'bg-foreground/10')}>{n}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Pending, for the chosen kind only ── */}
          {rows.length === 0 ? (
            <EmptyState
              icon={CheckCheck}
              title={`No ${current?.label.toLowerCase()} waiting`}
              description={
                tab === 'tasks'
                  ? 'Work comes here when someone finishes a task you handed out with “require my approval” switched on. None of yours is waiting.'
                  : counts.total > 0
                    ? 'Nothing of this kind needs you. Check the other tabs — they have something.'
                    : 'Nothing is waiting on you right now.'
              }
            />
          ) : (
            <GlassCard className="space-y-2.5 p-3">
              {tab === 'leaves' && rows.map((l) => (
                <ApprovalCard
                  key={l.id}
                  title={l.user?.name || 'Someone'}
                  subtitle={`${LEAVE_TYPE_LABELS[l.type] ?? l.type} · ${formatRange(l.startYMD, l.endYMD)}`}
                  waiting={waitingFor(l.appliedAt)}
                  meta={[`${l.workingDays} working day${l.workingDays === 1 ? '' : 's'}${l.halfDay ? ' (half)' : ''}`, l.user?.employeeId]}
                  busy={busy}
                  onApprove={() => decideLeave.mutate({ id: l.id, decision: 'APPROVE', note: '' })}
                  onReject={(reason) => decideLeave.mutate({ id: l.id, decision: 'REJECT', note: reason })}
                >
                  {l.reason ? <p className="mt-2 break-words text-sm text-muted-foreground">“{l.reason}”</p> : null}
                </ApprovalCard>
              ))}

              {tab === 'regularizations' && rows.map((r) => (
                <ApprovalCard
                  key={r.id}
                  title={r.user?.name || 'Someone'}
                  subtitle={formatYMD(r.dateYMD)}
                  waiting={waitingFor(r.createdAt)}
                  meta={[r.requestedCheckIn ? `in ${r.requestedCheckIn}` : null, r.requestedCheckOut ? `out ${r.requestedCheckOut}` : null, r.user?.employeeId]}
                  busy={busy}
                  requireReason={false}
                  onApprove={() => decideFix.mutate({ id: r.id, decision: 'APPROVED', note: '' })}
                  onReject={(reason) => decideFix.mutate({ id: r.id, decision: 'REJECTED', note: reason })}
                >
                  {r.reason ? <p className="mt-2 break-words text-sm text-muted-foreground">“{r.reason}”</p> : null}
                </ApprovalCard>
              ))}

              {tab === 'tasks' && rows.map((t) => (
                <ApprovalCard
                  key={t.id}
                  title={t.title}
                  subtitle={`Submitted by ${t.completedBy?.name || t.owner?.name || 'them'}`}
                  waiting={waitingFor(t.submittedAt)}
                  meta={[t.dueYMD ? `due ${formatYMD(t.dueYMD)}` : null, t.owner?.employeeId]}
                  busy={busy}
                  rejectLabel="Send back"
                  onApprove={() => decideTask.mutate({ id: t.id, approve: true, reason: '' })}
                  onReject={(reason) => decideTask.mutate({ id: t.id, approve: false, reason })}
                >
                  {t.notes ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{t.notes}</p> : null}
                </ApprovalCard>
              ))}
            </GlassCard>
          )}

          {/* ── History, same kind, its own window ── */}
          <section className="space-y-2.5">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="flex w-full items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-3 py-2.5 text-left transition-colors hover:bg-foreground/5"
            >
              <History className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-semibold tracking-tight">History</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {current ? `${current.label.toLowerCase()} you've decided` : ''}
              </span>
              <span className="shrink-0 text-xs font-medium text-primary">{showHistory ? 'Hide' : 'Show'}</span>
            </button>

            {showHistory ? (
              <div className="space-y-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {RANGES.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setRangeKey(r.key)}
                      aria-pressed={rangeKey === r.key}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors',
                        rangeKey === r.key ? 'bg-primary text-primary-foreground ring-primary' : 'bg-background/40 text-muted-foreground ring-border hover:text-foreground',
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {rangeKey === 'custom' ? <DateRange value={custom} onChange={setCustom} min={APP_LIVE_YMD} /> : null}

                <GlassCard className="p-3">
                  {!historyReady ? (
                    <p className="p-6 text-center text-sm text-muted-foreground">Pick a start and an end date.</p>
                  ) : histLoading && !history ? (
                    <LoadingState label="Loading…" />
                  ) : (
                    <HistoryList history={history} kind={tab} />
                  )}
                </GlassCard>
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

function HistoryList({ history, kind }) {
  const rows = React.useMemo(() => {
    if (!history) return [];
    if (kind === 'leaves') {
      return (history.leaves ?? []).map((l) => ({
        id: l.id, when: l.decidedAt, who: l.user?.name,
        what: `${LEAVE_TYPE_LABELS[l.type] ?? l.type} · ${formatRange(l.startYMD, l.endYMD)}`,
        by: l.decidedBy?.name, status: l.status, verb: l.status, note: l.decisionNote,
      }));
    }
    if (kind === 'regularizations') {
      return (history.regularizations ?? []).map((r) => ({
        id: r.id, when: r.decidedAt, who: r.user?.name,
        what: `Correction · ${formatYMD(r.dateYMD)}`,
        by: r.decidedBy?.name, status: r.status, verb: r.status, note: r.decisionNote,
      }));
    }
    // No `by` here: a task approval is always yours, so naming you on every row is noise.
    return (history.tasks ?? []).map((t) => ({
      id: t.id, when: t.completedAt || t.updatedAt, who: t.owner?.name, what: t.title,
      status: t.status === 'DONE' ? 'APPROVED' : 'REJECTED',
      verb: t.status === 'DONE' ? 'APPROVED' : 'SENT_BACK',
      note: t.rejectionReason,
    }));
  }, [history, kind]);

  if (!rows.length) {
    return <p className="p-6 text-center text-sm text-muted-foreground">Nothing decided in this window.</p>;
  }

  return (
    <>
      <p className="px-1 pb-2 text-xs text-muted-foreground">
        {rows.length} decision{rows.length === 1 ? '' : 's'} · {formatYMD(history.range?.from)} – {formatYMD(history.range?.to)}
      </p>
      <div className="divide-y divide-border/50">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 py-2.5">
            <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
              <p className="break-words text-sm font-medium">{r.who || '—'}</p>
              <p className="break-words text-xs text-muted-foreground">
                {r.what}
                {r.by ? <span className="text-muted-foreground/70"> · by {r.by}</span> : null}
              </p>
              {r.note ? <p className="mt-0.5 break-words text-xs italic text-muted-foreground">“{r.note}”</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge tone={TONE[r.status] ?? 'neutral'}>{VERB[r.verb] ?? r.status}</StatusBadge>
              <span className="text-xs tabular-nums text-muted-foreground">{formatYMD(decidedOn(r.when))}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
