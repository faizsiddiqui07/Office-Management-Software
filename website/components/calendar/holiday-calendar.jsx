'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, LayoutGrid, List, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { GlassPanel } from '@/components/glass/glass-panel';
import { EmptyState } from '@/components/glass/empty-state';
import { Button } from '@/components/ui/button';
import { EVENT_TYPES, buildMonthGrid, expandEventDates, monthLabel, todayYMDLocal } from '@/lib/calendar';
import { formatRange } from '@/lib/leave';
import { HolidayDialog } from './holiday-dialog';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function HolidayCalendar() {
  const { user } = useAuth();
  const isAdmin = !!user && can(user, 'editCalendar');
  const today = React.useMemo(() => new Date(), []);
  const [year, setYear] = React.useState(today.getFullYear());
  const [month, setMonth] = React.useState(today.getMonth());
  const [mode, setMode] = React.useState('month');
  const [dialog, setDialog] = React.useState(null);

  const { data } = useQuery({
    queryKey: ['holidays', year, month],
    queryFn: () => api.get(`/holidays?year=${year}&month=${month + 1}`),
  });
  const events = data?.holidays ?? [];

  const byDate = React.useMemo(() => {
    const m = new Map();
    for (const ev of events) {
      for (const d of expandEventDates(ev)) {
        if (!m.has(d)) m.set(d, []);
        m.get(d).push(ev);
      }
    }
    return m;
  }, [events]);

  const grid = React.useMemo(() => buildMonthGrid(year, month), [year, month]);
  const todayYMD = todayYMDLocal();

  const prev = () => (month === 0 ? (setYear((y) => y - 1), setMonth(11)) : setMonth((m) => m - 1));
  const next = () => (month === 11 ? (setYear((y) => y + 1), setMonth(0)) : setMonth((m) => m + 1));
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  };

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={prev} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-[10rem] text-center text-lg font-semibold tracking-tight">{monthLabel(year, month)}</h2>
          <Button variant="ghost" size="icon" onClick={next} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday} className="ml-2">
            Today
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => setMode('month')}
              className={cn('inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium', mode === 'month' ? 'bg-background shadow-sm' : 'text-muted-foreground')}
            >
              <LayoutGrid className="size-3.5" /> Month
            </button>
            <button
              type="button"
              onClick={() => setMode('agenda')}
              className={cn('inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium', mode === 'agenda' ? 'bg-background shadow-sm' : 'text-muted-foreground')}
            >
              <List className="size-3.5" /> Agenda
            </button>
          </div>
          {isAdmin ? (
            <Button size="sm" onClick={() => setDialog({ mode: 'create', startYMD: todayYMD })}>
              <Plus /> Add
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {Object.entries(EVENT_TYPES).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cn('size-2 rounded-full', v.dot)} /> {v.label}
          </span>
        ))}
      </div>

      {mode === 'month' ? (
        <div className="mt-4">
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {grid.map((cell) => {
              const dayEvents = byDate.get(cell.ymd) ?? [];
              const isToday = cell.ymd === todayYMD;
              return (
                <div
                  key={cell.ymd}
                  onClick={() => (isAdmin ? setDialog({ mode: 'create', startYMD: cell.ymd }) : undefined)}
                  className={cn(
                    'min-h-[84px] rounded-xl border border-border/40 p-1.5 transition-colors',
                    cell.inMonth ? 'bg-background/30' : 'bg-transparent text-muted-foreground/40',
                    isAdmin && 'cursor-pointer hover:bg-foreground/5',
                  )}
                >
                  <div className={cn('flex size-6 items-center justify-center rounded-full text-xs', isToday && 'bg-primary font-semibold text-primary-foreground')}>
                    {cell.date.getDate()}
                  </div>
                  <div className="mt-1 space-y-1">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <button
                        key={`${ev.id}-${cell.ymd}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isAdmin) setDialog({ mode: 'edit', holiday: ev });
                        }}
                        className={cn('block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[10px] font-medium', EVENT_TYPES[ev.type]?.chip)}
                      >
                        {ev.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 ? <p className="px-1 text-[10px] text-muted-foreground">+{dayEvents.length - 3} more</p> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-4">
          {events.length ? (
            <ul className="divide-y divide-border/50">
              {[...events]
                .sort((a, b) => a.startYMD.localeCompare(b.startYMD))
                .map((ev) => {
                  const t = EVENT_TYPES[ev.type] ?? EVENT_TYPES.EVENT;
                  return (
                    <li key={ev.id}>
                      <button
                        type="button"
                        onClick={() => (isAdmin ? setDialog({ mode: 'edit', holiday: ev }) : undefined)}
                        className={cn('flex w-full items-start gap-3 py-3 text-left', isAdmin && 'transition-colors hover:opacity-80')}
                      >
                        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', t.dot)} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{ev.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatRange(ev.startYMD, ev.endYMD)} · {t.label}
                          </p>
                          {ev.description ? <p className="mt-0.5 text-xs text-muted-foreground">{ev.description}</p> : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
            </ul>
          ) : (
            <EmptyState title="No entries this month" description="Use the month view's Add button to create holidays and events." />
          )}
        </div>
      )}

      {dialog ? (
        <HolidayDialog
          open={!!dialog}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          holiday={dialog.mode === 'edit' ? dialog.holiday : undefined}
          defaultStartYMD={dialog.startYMD}
        />
      ) : null}
    </GlassPanel>
  );
}
