'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { GlassCard } from '@/components/glass/glass-card';
import { StatusBadge } from '@/components/glass/status-badge';
import { EVENT_TYPES, fiscalYearEndYMD, todayYMDLocal } from '@/lib/calendar';
import { formatRange, formatYMD } from '@/lib/leave';

export function UpcomingHolidays() {
  // Everything left in the office's own year, up to 31 March. The year's holiday list is
  // drawn up in one go and the next one goes up in April, so that is where "upcoming"
  // genuinely ends; on 1 April this window rolls forward by itself.
  const today = todayYMDLocal();
  const to = fiscalYearEndYMD(today);

  const { data } = useQuery({
    queryKey: ['holidays', 'upcoming', today],
    queryFn: () => api.get(`/holidays?from=${today}&to=${to}`),
  });

  // Oldest-first, and today's own holiday stays until the day is over. Nothing is cut:
  // the whole list is here and the box scrolls, so 31 March is always reachable — and a
  // date that passes simply drops off the top by itself.
  const upcoming = (data?.holidays ?? [])
    .filter((h) => h.endYMD >= today)
    .sort((a, b) => a.startYMD.localeCompare(b.startYMD));

  const cardRef = React.useRef(null);
  const [boxH, setBoxH] = React.useState(0); // 0 = phone (stacked): apni hi height

  // ── 1. The card is exactly as tall as the calendar beside it ──────────────
  // Measured off the calendar itself (this card's previous grid sibling) rather than
  // stretched by CSS: a stretched grid item still sizes the ROW by its own content, so a
  // long list would simply make the row taller and the two boxes would stop matching —
  // which is what it did when it listed everything. An explicit height cannot do that.
  // Below `lg` the two stack, there is nothing to match, and the height is left alone.
  React.useLayoutEffect(() => {
    const card = cardRef.current;
    const calendar = card?.previousElementSibling;
    if (!card || !calendar) return undefined;
    const apply = () => {
      const beside = window.matchMedia('(min-width: 1024px)').matches;
      setBoxH(beside ? Math.round(calendar.getBoundingClientRect().height) : 0);
    };
    apply();
    // The calendar changes height on its own (a 6-row month, a month switch), so watch it
    // rather than only the window.
    const ro = new ResizeObserver(apply);
    ro.observe(calendar);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);

  return (
    <GlassCard
      ref={cardRef}
      className="flex flex-col overflow-hidden p-5"
      style={boxH ? { height: boxH } : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 className="text-sm font-semibold">Upcoming</h3>
        {/* Where the list ends, so its tail reads as "the year is done", not as
            "something is missing". */}
        <span className="text-xs text-muted-foreground">till {formatYMD(to)}</span>
      </div>
      {upcoming.length ? (
        // The list scrolls INSIDE the card, so every date up to 31 March is reachable
        // without the card ever outgrowing the calendar next to it. On a phone the two
        // stack and there is no calendar to match, so a fixed ~7 rows keeps the page
        // short; the eighth row peeking under the edge is what says "this scrolls".
        // overscroll-contain stops a flick at the end of the list from carrying on and
        // scrolling the whole page.
        <ul className="mt-3 max-h-[23rem] min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1 lg:max-h-none">
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
