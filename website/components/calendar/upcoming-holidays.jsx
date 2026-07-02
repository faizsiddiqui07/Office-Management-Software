'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { GlassCard } from '@/components/glass/glass-card';
import { StatusBadge } from '@/components/glass/status-badge';
import { EVENT_TYPES, todayYMDLocal } from '@/lib/calendar';
import { formatRange } from '@/lib/leave';

export function UpcomingHolidays() {
  // Rolling 90-day window (not calendar-year) so January's holidays show in December.
  const today = todayYMDLocal();
  const horizon = new Date(`${today}T00:00:00`);
  horizon.setDate(horizon.getDate() + 90);
  const to = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, '0')}-${String(horizon.getDate()).padStart(2, '0')}`;

  const { data } = useQuery({
    queryKey: ['holidays', 'upcoming', today],
    queryFn: () => api.get(`/holidays?from=${today}&to=${to}`),
  });

  const upcoming = (data?.holidays ?? [])
    .filter((h) => h.endYMD >= today)
    .sort((a, b) => a.startYMD.localeCompare(b.startYMD))
    .slice(0, 6);

  return (
    <GlassCard className="p-5">
      <h3 className="text-sm font-semibold">Upcoming</h3>
      {upcoming.length ? (
        <ul className="mt-3 space-y-3">
          {upcoming.map((h) => {
            const t = EVENT_TYPES[h.type] ?? EVENT_TYPES.EVENT;
            return (
              <li key={h.id} className="flex items-start gap-3">
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', t.dot)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{h.title}</p>
                  <p className="text-xs text-muted-foreground">{formatRange(h.startYMD, h.endYMD)}</p>
                </div>
                <StatusBadge tone={t.tone} dot={false} className="shrink-0">
                  {t.label}
                </StatusBadge>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Nothing in the next 90 days.</p>
      )}
    </GlassCard>
  );
}
