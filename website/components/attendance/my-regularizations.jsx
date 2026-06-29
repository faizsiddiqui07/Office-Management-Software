'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { GlassCard } from '@/components/glass/glass-card';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { RegularizationDialog } from './regularization-dialog';

function fmtDate(ymd) {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function to12(hm) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  const ap = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap}`;
}

export function MyRegularizations() {
  const { data } = useQuery({ queryKey: ['regularizations', 'me'], queryFn: () => api.get('/regularizations/me') });
  const requests = data?.requests ?? [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="text-lg font-semibold tracking-tight">Attendance corrections</h2>
        <RegularizationDialog />
      </div>
      {requests.length ? (
        <GlassCard className="divide-y divide-border/50 p-2">
          {requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{fmtDate(r.dateYMD)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[r.requestedCheckIn && `In ${to12(r.requestedCheckIn)}`, r.requestedCheckOut && `Out ${to12(r.requestedCheckOut)}`].filter(Boolean).join(' · ')}
                  {r.reason ? ` · ${r.reason}` : ''}
                </p>
              </div>
              <StatusBadge tone={STATUS_TONES[r.status] ?? 'warning'} className="shrink-0">{r.status}</StatusBadge>
            </div>
          ))}
        </GlassCard>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">No correction requests. Forgot to check in/out? Request a fix above.</p>
      )}
    </section>
  );
}
