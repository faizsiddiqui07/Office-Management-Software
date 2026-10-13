'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import { GlassCard } from '@/components/glass/glass-card';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { LoadingState } from '@/components/glass/skeletons';
import { RegularizationDialog } from './regularization-dialog';
import { RegularizationDetailDialog } from './regularization-detail-dialog';

function fmtDate(ymd) {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
// Times are stored as 24h "HH:mm" — render them as-is (24h everywhere).
function label(status) {
  const s = String(status || '');
  return s.charAt(0) + s.slice(1).toLowerCase();
}

export function MyRegularizations() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['regularizations', 'me'], queryFn: () => api.get('/regularizations/me') });
  const requests = data?.requests ?? [];
  // Tap a correction for the whole request — the times asked for, the reason, and who
  // decided it with their note. The row only has room for a line of it.
  const [viewing, setViewing] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const [withdrawing, setWithdrawing] = React.useState(null);

  // Edit aur withdraw sirf PENDING tak. Ye rok asli taur par SERVER par hai
  // (regularization.service.js) — yahan ka UI bas wahi baat dikhata hai, taaki banda
  // aisa button na dabaye jo waise bhi mana ho jata.
  const isPending = viewing?.status === 'PENDING';

  const withdrawMut = useMutation({
    mutationFn: (id) => api.post(`/regularizations/${id}/cancel`, {}),
    onSuccess: () => {
      toast.success('Request withdrawn');
      qc.invalidateQueries({ queryKey: ['regularizations'] });
      setWithdrawing(null);
      setViewing(null);
    },
    onError: (e) => toast.error(e?.message || 'Could not withdraw the request'),
  });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="text-lg font-semibold tracking-tight">Attendance corrections</h2>
        <RegularizationDialog />
      </div>
      {isLoading ? (
        <LoadingState label="Loading corrections…" />
      ) : requests.length ? (
        <GlassCard className="divide-y divide-border/50 p-2">
          {requests.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setViewing(r)}
              className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-none"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{fmtDate(r.dateYMD)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[r.requestedCheckIn && `In ${r.requestedCheckIn}`, r.requestedCheckOut && `Out ${r.requestedCheckOut}`].filter(Boolean).join(' · ')}
                  {r.reason ? ` · ${r.reason}` : ''}
                </p>
              </div>
              <StatusBadge tone={STATUS_TONES[r.status] ?? 'warning'} className="shrink-0">{label(r.status)}</StatusBadge>
            </button>
          ))}
        </GlassCard>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">No correction requests. Forgot to check in/out? Request a fix above.</p>
      )}

      <RegularizationDetailDialog
        request={viewing}
        open={!!viewing}
        onOpenChange={(o) => (!o ? setViewing(null) : null)}
        footer={
          isPending ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" className="text-destructive" onClick={() => setWithdrawing(viewing)}>
                Withdraw
              </Button>
              <Button
                onClick={() => {
                  const r = viewing;
                  setViewing(null);
                  setEditing(r);
                }}
              >
                <Pencil className="size-4" /> Edit
              </Button>
            </div>
          ) : null
        }
      />

      {/* Edit detail dialog ke footer se khulta hai, kisi trigger se nahi — isliye
          controlled. Bilkul wahi dhancha jo leave-history.jsx me hai. */}
      <RegularizationDialog
        editing={editing}
        open={!!editing}
        onOpenChange={(o) => (!o ? setEditing(null) : null)}
      />

      <ConfirmDialog
        open={!!withdrawing}
        onOpenChange={(o) => (!o ? setWithdrawing(null) : null)}
        title="Withdraw this correction request?"
        description="It will be taken off leadership's review queue. You can always raise a new one."
        confirmLabel="Withdraw"
        tone="destructive"
        loading={withdrawMut.isPending}
        onConfirm={() => withdrawMut.mutate(withdrawing.id)}
      />
    </section>
  );
}
