'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, CheckCheck, ClipboardCheck, Inbox, TriangleAlert, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/glass/page-header';
import { GlassCard } from '@/components/glass/glass-card';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { StatusBadge } from '@/components/glass/status-badge';
import { Button } from '@/components/ui/button';
import { ApprovalCard, SectionHead, waitingFor } from '@/components/approvals/approval-card';
import { LEAVE_TYPE_LABELS, formatRange, formatYMD } from '@/lib/leave';

/**
 * Everything waiting on this person's decision, in one place.
 *
 * The page only READS from /approvals. Every decision is sent to the endpoint that
 * already owned it, the same one the Leaves, Attendance and To-Do pages use — so
 * approving here and approving there are the same act, and no rule can drift between
 * the two. Those pages keep working exactly as before.
 *
 * Which sections appear is decided by the server, not here: leave and corrections need
 * their permission, tasks need only that you handed the work out yourself.
 */
export default function ApprovalsPage() {
  const qc = useQueryClient();
  const [showHistory, setShowHistory] = React.useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: () => api.get('/approvals'),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const { data: history, isLoading: histLoading } = useQuery({
    queryKey: ['approvals', 'history'],
    queryFn: () => api.get('/approvals/history?days=30'),
    enabled: showHistory,
  });

  // One place to refresh everything a decision can touch — the inbox itself plus the
  // pages the decision actually lives on, so neither goes stale behind the other.
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

  // NOTE the vocabulary: corrections take APPROVED/REJECTED while leave takes
  // APPROVE/REJECT. Two different enums on two endpoints that existed before this
  // page; sending leave's words here failed validation and made both buttons dead.
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
  const sections = data?.sections ?? {};
  const counts = data?.counts ?? { total: 0 };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Approvals"
        title="Waiting on you"
        icon={Inbox}
        description="Leave, attendance corrections and delegated work — everything that needs your decision, in one place."
        actions={
          <Button variant="outline" onClick={() => setShowHistory((v) => !v)}>
            <CheckCheck className="size-4" /> {showHistory ? 'Hide' : 'Recent decisions'}
          </Button>
        }
      />

      {/* The error case comes FIRST. Falling through to the empty state would tell an
          approver "nothing is waiting on you" when the request merely failed — the one
          wrong answer this page must never give. */}
      {isError && !data ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn’t load your approvals"
          description={error?.message || 'Something went wrong on the way. Check your connection and try again.'}
          action={<Button variant="outline" onClick={() => refetch()}>Try again</Button>}
        />
      ) : isLoading && !data ? (
        <LoadingState label="Gathering everything…" />
      ) : counts.total === 0 ? (
        <EmptyState
          icon={CheckCheck}
          title="All clear"
          description="Nothing is waiting on you right now. Anything new will show up here, and the sidebar will carry a dot."
        />
      ) : (
        <div className="space-y-6">
          {sections.leaves && data.leaves.length ? (
            <section className="space-y-2.5">
              <SectionHead icon={CalendarDays} title="Leave requests" count={data.leaves.length} hint="oldest first" />
              <GlassCard className="space-y-2.5 p-3">
                {data.leaves.map((l) => (
                  <ApprovalCard
                    key={l.id}
                    title={l.user?.name || 'Someone'}
                    subtitle={`${LEAVE_TYPE_LABELS[l.type] ?? l.type} · ${formatRange(l.startYMD, l.endYMD)}`}
                    waiting={waitingFor(l.appliedAt)}
                    meta={[
                      `${l.workingDays} working day${l.workingDays === 1 ? '' : 's'}${l.halfDay ? ' (half)' : ''}`,
                      l.user?.employeeId,
                    ]}
                    busy={busy}
                    onApprove={() => decideLeave.mutate({ id: l.id, decision: 'APPROVE', note: '' })}
                    onReject={(reason) => decideLeave.mutate({ id: l.id, decision: 'REJECT', note: reason })}
                  >
                    {l.reason ? <p className="mt-2 text-sm text-muted-foreground">“{l.reason}”</p> : null}
                  </ApprovalCard>
                ))}
              </GlassCard>
            </section>
          ) : null}

          {sections.regularizations && data.regularizations.length ? (
            <section className="space-y-2.5">
              <SectionHead icon={Wrench} title="Attendance corrections" count={data.regularizations.length} hint="oldest first" />
              <GlassCard className="space-y-2.5 p-3">
                {data.regularizations.map((r) => (
                  <ApprovalCard
                    key={r.id}
                    title={r.user?.name || 'Someone'}
                    subtitle={formatYMD(r.dateYMD)}
                    waiting={waitingFor(r.createdAt)}
                    meta={[
                      r.requestedCheckIn ? `in ${r.requestedCheckIn}` : null,
                      r.requestedCheckOut ? `out ${r.requestedCheckOut}` : null,
                      r.user?.employeeId,
                    ]}
                    busy={busy}
                    requireReason={false}
                    onApprove={() => decideFix.mutate({ id: r.id, decision: 'APPROVED', note: '' })}
                    onReject={(reason) => decideFix.mutate({ id: r.id, decision: 'REJECTED', note: reason })}
                  >
                    {r.reason ? <p className="mt-2 text-sm text-muted-foreground">“{r.reason}”</p> : null}
                  </ApprovalCard>
                ))}
              </GlassCard>
            </section>
          ) : null}

          {data.tasks.length ? (
            <section className="space-y-2.5">
              <SectionHead icon={ClipboardCheck} title="Work you assigned" count={data.tasks.length} hint="submitted for your approval" />
              <GlassCard className="space-y-2.5 p-3">
                {data.tasks.map((t) => (
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
                    {t.notes ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{t.notes}</p> : null}
                  </ApprovalCard>
                ))}
              </GlassCard>
            </section>
          ) : null}
        </div>
      )}

      {showHistory ? (
        <section className="space-y-2.5">
          <SectionHead icon={CheckCheck} title="What you decided" count={
            (history?.leaves?.length ?? 0) + (history?.regularizations?.length ?? 0) + (history?.tasks?.length ?? 0)
          } hint="last 30 days" />
          <GlassCard className="p-3">
            {histLoading && !history ? (
              <LoadingState label="Loading…" />
            ) : (
              <HistoryList history={history} />
            )}
          </GlassCard>
        </section>
      ) : null}
    </div>
  );
}

const TONE = { APPROVED: 'success', REJECTED: 'destructive' };
// A task goes BACK to whoever did it; a leave or a correction is simply refused. Using
// one word for both made a rejected leave read as if it had been returned for changes.
const VERB = { APPROVED: 'Approved', REJECTED: 'Rejected', SENT_BACK: 'Sent back' };

/**
 * The decision date in company time. `decidedAt` is a plain UTC instant, so slicing the
 * ISO string dates anything decided between midnight and 05:30 IST to the day before.
 */
function decidedOnYMD(when) {
  if (!when) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(when));
}

function HistoryList({ history }) {
  const rows = [
    ...(history?.leaves ?? []).map((l) => ({
      id: `l-${l.id}`,
      when: l.decidedAt,
      who: l.user?.name,
      what: `${LEAVE_TYPE_LABELS[l.type] ?? l.type} leave · ${formatRange(l.startYMD, l.endYMD)}`,
      status: l.status,
      note: l.decisionNote,
    })),
    ...(history?.regularizations ?? []).map((r) => ({
      id: `r-${r.id}`,
      when: r.decidedAt,
      who: r.user?.name,
      what: `Attendance correction · ${formatYMD(r.dateYMD)}`,
      status: r.status,
      note: r.decisionNote,
    })),
    ...(history?.tasks ?? []).map((t) => ({
      id: `t-${t.id}`,
      when: t.completedAt || t.updatedAt,
      who: t.owner?.name,
      what: t.title,
      // A rejected task goes back to PENDING and keeps the reason, so the reason is
      // what says it was sent back — the status alone can't.
      status: t.status === 'DONE' ? 'APPROVED' : 'REJECTED',
      verb: t.status === 'DONE' ? 'APPROVED' : 'SENT_BACK',
      note: t.rejectionReason,
    })),
  ].sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));

  if (!rows.length) return <p className="p-6 text-center text-sm text-muted-foreground">Nothing decided in the last 30 days.</p>;

  return (
    <div className="divide-y divide-border/50">
      {/* basis-full below sm so the badge + date sit on their own line instead of
          squeezing the name and description into a third of a 360px screen. */}
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 py-2.5">
          <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
            <p className="break-words text-sm font-medium">{r.who || '—'}</p>
            <p className="break-words text-xs text-muted-foreground">{r.what}</p>
            {r.note ? <p className="mt-0.5 break-words text-xs italic text-muted-foreground">“{r.note}”</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge tone={TONE[r.status] ?? 'neutral'}>{VERB[r.verb ?? r.status] ?? r.status}</StatusBadge>
            <span className="text-xs text-muted-foreground">{formatYMD(decidedOnYMD(r.when))}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
