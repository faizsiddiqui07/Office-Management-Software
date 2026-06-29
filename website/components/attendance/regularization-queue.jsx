'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Wrench, X } from 'lucide-react';
import { api } from '@/lib/api';
import { prettyRole } from '@/lib/permissions';
import { GlassCard } from '@/components/glass/glass-card';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { Button } from '@/components/ui/button';

function fmtDate(ymd) {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function to12(hm) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  const ap = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap}`;
}

export function RegularizationQueue() {
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
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">
              {r.user?.name} <span className="text-xs font-normal text-muted-foreground">· {prettyRole(r.user?.role)}</span>
            </p>
            <p className="text-sm">
              {fmtDate(r.dateYMD)} —{' '}
              {[r.requestedCheckIn && `In ${to12(r.requestedCheckIn)}`, r.requestedCheckOut && `Out ${to12(r.requestedCheckOut)}`].filter(Boolean).join(' · ')}
            </p>
            <p className="text-xs text-muted-foreground">{r.reason}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, decision: 'REJECTED' })} disabled={decide.isPending}>
              <X className="size-4" /> Reject
            </Button>
            <Button size="sm" onClick={() => decide.mutate({ id: r.id, decision: 'APPROVED' })} disabled={decide.isPending}>
              <Check className="size-4" /> Approve
            </Button>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}
