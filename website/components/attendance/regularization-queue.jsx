'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, History, Trash2, Wrench, X } from 'lucide-react';
import { api } from '@/lib/api';
import { prettyRole } from '@/lib/permissions';
import { GlassCard } from '@/components/glass/glass-card';
import { StatusBadge } from '@/components/glass/status-badge';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
        {r.user?.name} <span className="text-xs font-normal text-muted-foreground">· {prettyRole(r.user?.role)}</span>
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

  const decide = useMutation({
    mutationFn: ({ id, decision }) => api.post(`/regularizations/${id}/decide`, { decision }),
    onSuccess: (_d, v) => {
      toast.success(v.decision === 'APPROVED' ? 'Approved — attendance updated' : 'Request rejected');
      qc.invalidateQueries({ queryKey: ['regularizations'] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not decide'),
  });

  if (isLoading) return <LoadingState label="Loading correction requests…" />;
  if (!requests.length)
    return <EmptyState icon={Wrench} title="No pending corrections" description="Attendance correction requests will appear here for your review." />;

  return (
    <div className="space-y-3">
      {requests.map((r) => (
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

function HistoryList() {
  const { data, isLoading } = useQuery({ queryKey: ['regularizations', 'history'], queryFn: () => api.get('/regularizations/history') });
  const requests = data?.requests ?? [];

  if (isLoading) return <LoadingState label="Loading history…" />;
  if (!requests.length)
    return <EmptyState icon={History} title="No decided corrections yet" description="Approved and rejected corrections will show here." />;

  return (
    <div className="space-y-3">
      {requests.map((r) => (
        <GlassCard key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={r.status === 'APPROVED' ? 'success' : 'destructive'}>
                {r.status === 'APPROVED' ? 'Approved' : 'Rejected'}
              </StatusBadge>
              <span className="text-sm font-medium">{r.user?.name}</span>
              <span className="text-xs text-muted-foreground">· {prettyRole(r.user?.role)}</span>
            </div>
            <p className="text-sm">
              {fmtDate(r.dateYMD)} —{' '}
              {[r.requestedCheckIn && `In ${to12(r.requestedCheckIn)}`, r.requestedCheckOut && `Out ${to12(r.requestedCheckOut)}`]
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
