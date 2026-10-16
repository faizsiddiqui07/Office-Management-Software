'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { GlassCard } from '@/components/glass/glass-card';
import { StatusBadge } from '@/components/glass/status-badge';
import { EVENT_TYPES, fiscalYearEndYMD, todayYMDLocal } from '@/lib/calendar';
import { formatRange, formatYMD } from '@/lib/leave';

/** `space-y-3` between list items, in px — the measuring needs the real number. */
const GAP_PX = 12;

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

  // Oldest-first, and today's own holiday stays until the day is over. Nothing is sliced
  // here: the QUEUE is this whole list, and the card shows as much of its head as fits.
  const upcoming = (data?.holidays ?? [])
    .filter((h) => h.endYMD >= today)
    .sort((a, b) => a.startYMD.localeCompare(b.startYMD));

  const cardRef = React.useRef(null);
  const listRef = React.useRef(null);
  const [boxH, setBoxH] = React.useState(0); // 0 = phone (stacked): koi seema nahi
  const [fit, setFit] = React.useState(0); // 0 = abhi naapa nahi

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

  // ── 2. How many whole rows fit in that height ─────────────────────────────
  // Every row is the same height (the title is truncated to one line), so this is
  // arithmetic, not a per-item walk. Half a holiday hanging off the bottom edge is worse
  // than one fewer holiday, hence `floor`.
  React.useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    // No box to match (phone, where the two stack) → no trimming at all. Measuring here
    // would be self-fulfilling: with the card free to grow, the available height IS the
    // height of whatever is currently rendered, so the first trim would stick for good
    // and the queue could never come back.
    if (!boxH) {
      setFit(0);
      return undefined;
    }
    const measure = () => {
      const first = el.firstElementChild;
      const avail = el.clientHeight;
      if (!first || !avail) return;
      const itemH = first.getBoundingClientRect().height;
      if (!itemH) return;
      // +0.5 absorbs sub-pixel rounding, which on a phone (where `avail` is exactly the
      // content height) is the difference between showing every row and dropping the last.
      setFit(Math.max(1, Math.floor((avail + GAP_PX + 0.5) / (itemH + GAP_PX))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [upcoming.length, boxH]);

  const shown = boxH && fit ? upcoming.slice(0, fit) : upcoming;
  const queued = upcoming.length - shown.length;

  return (
    <GlassCard
      ref={cardRef}
      className="flex flex-col overflow-hidden p-5"
      style={boxH ? { height: boxH } : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 className="text-sm font-semibold">Upcoming</h3>
        {/* When some are still queued, say how many — otherwise say where the list ends,
            so an empty tail reads as "the year is done", not as "something is missing". */}
        <span className="text-xs text-muted-foreground">
          {queued > 0 ? `+${queued} more` : `till ${formatYMD(to)}`}
        </span>
      </div>
      {upcoming.length ? (
        // overflow-hidden is the safety net: between a month change and the next measure
        // there can be one frame with a row too many, and it must not spill out the card.
        <ul ref={listRef} className="mt-3 min-h-0 flex-1 space-y-3 overflow-hidden">
          {shown.map((h) => {
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
