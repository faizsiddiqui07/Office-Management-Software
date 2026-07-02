'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { GlassCard } from '@/components/glass/glass-card';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { LoadingState } from '@/components/glass/skeletons';
import { RegularizationDialog } from './regularization-dialog';

function fmtDate(ymd) {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
// Times are stored as 24h "HH:mm" — render them as-is (24h everywhere).
function label(status) {
  const s = String(status || '');
  return s.charAt(0) + s.slice(1).toLowerCase();
}

export function MyRegularizations() {
  const { data, isLoading } = useQuery({ queryKey: ['regularizations', 'me'], queryFn: () => api.get('/regularizations/me') });
  const requests = data?.requests ?? [];

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
            <div key={r.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{fmtDate(r.dateYMD)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[r.requestedCheckIn && `In ${r.requestedCheckIn}`, r.requestedCheckOut && `Out ${r.requestedCheckOut}`].filter(Boolean).join(' · ')}
                  {r.reason ? ` · ${r.reason}` : ''}
                </p>
              </div>
              <StatusBadge tone={STATUS_TONES[r.status] ?? 'warning'} className="shrink-0">{label(r.status)}</StatusBadge>
            </div>
          ))}
        </GlassCard>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">No correction requests. Forgot to check in/out? Request a fix above.</p>
      )}
    </section>
  );
}
