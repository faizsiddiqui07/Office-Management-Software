'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { GlassCard } from '@/components/glass/glass-card';
import { StatusBadge } from '@/components/glass/status-badge';
import { EVENT_TYPES, fiscalYearEndYMD, todayYMDLocal } from '@/lib/calendar';
import { formatRange, formatYMD } from '@/lib/leave';

export function UpcomingHolidays() {
  // Everything left in the office's own year, up to 31 March — not a rolling 90 days and
  // not a fixed six. The card sits beside a full month grid with room to spare, and a
  // list that stopped at six hid Holi behind nothing at all. The year's holiday list is
  // drawn up in one go and the next one goes up in April, so 31 March is where "upcoming"
  // genuinely ends; on 1 April this window rolls forward by itself.
  const today = todayYMDLocal();
  const to = fiscalYearEndYMD(today);

  const { data } = useQuery({
    queryKey: ['holidays', 'upcoming', today],
    queryFn: () => api.get(`/holidays?from=${today}&to=${to}`),
  });

  const upcoming = (data?.holidays ?? [])
    .filter((h) => h.endYMD >= today)
    .sort((a, b) => a.startYMD.localeCompare(b.startYMD));

  return (
    <GlassCard className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 className="text-sm font-semibold">Upcoming</h3>
        {/* Say where the list stops, so an empty tail reads as "the year is done",
            not as "something is missing". */}
        <span className="text-xs text-muted-foreground">till {formatYMD(to)}</span>
      </div>
      {upcoming.length ? (
        <ul className="mt-3 space-y-3">
          {upcoming.map((h) => {
            const t = EVENT_TYPES[h.type] ?? EVENT_TYPES.EVENT;
            return (
              <li key={h.occurrenceId || h.id} className="flex items-start gap-3">
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
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing left before {formatYMD(to)} — next year’s list goes up in April.
        </p>
      )}
    </GlassCard>
  );
}
