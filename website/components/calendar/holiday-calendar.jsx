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
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { EVENT_TYPES, buildMonthGrid, expandEventDates, monthLabel, todayYMDLocal } from '@/lib/calendar';
import { formatRange } from '@/lib/leave';
import { HolidayDialog } from './holiday-dialog';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtDay(ymd) {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function HolidayCalendar() {
  const { user } = useAuth();
  const isAdmin = !!user && can(user, 'editCalendar');
  const today = React.useMemo(() => new Date(), []);
  const [year, setYear] = React.useState(today.getFullYear());
  const [month, setMonth] = React.useState(today.getMonth());
  const [mode, setMode] = React.useState('month');
  const [dialog, setDialog] = React.useState(null);
  const [dayView, setDayView] = React.useState(null); // ymd — tap a day to see its events (everyone)

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
                // Tapping a day opens its events for EVERYONE (bottom sheet on mobile).
                <button
                  type="button"
                  key={cell.ymd}
                  onClick={() => setDayView(cell.ymd)}
                  className={cn(
                    'min-h-[56px] rounded-xl border border-border/40 p-1 text-left transition-colors hover:bg-foreground/5 sm:min-h-[84px] sm:p-1.5',
                    cell.inMonth ? 'bg-background/30' : 'bg-transparent text-muted-foreground/40',
                  )}
                >
                  <div className={cn('flex size-6 items-center justify-center rounded-full text-xs', isToday && 'bg-primary font-semibold text-primary-foreground')}>
                    {cell.date.getDate()}
                  </div>
                  {/* Mobile: colour dots (titles are unreadable at ~44px cells). */}
                  <div className="mt-1 flex flex-wrap gap-1 sm:hidden">
                    {dayEvents.slice(0, 4).map((ev) => (
                      <span key={`${ev.id}-${cell.ymd}-dot`} className={cn('size-1.5 rounded-full', EVENT_TYPES[ev.type]?.dot)} />
                    ))}
                    {dayEvents.length > 4 ? <span className="text-[9px] leading-none text-muted-foreground">+{dayEvents.length - 4}</span> : null}
                  </div>
                  {/* sm+: readable title chips. */}
                  <div className="mt-1 hidden space-y-1 sm:block">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <span
                        key={`${ev.id}-${cell.ymd}`}
                        className={cn('block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[10px] font-medium', EVENT_TYPES[ev.type]?.chip)}
                      >
                        {ev.title}
                      </span>
                    ))}
                    {dayEvents.length > 3 ? <p className="px-1 text-[10px] text-muted-foreground">+{dayEvents.length - 3} more</p> : null}
                  </div>
                </button>
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
                    <li key={ev.occurrenceId || ev.id}>
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
            <EmptyState
              title="No entries this month"
              description={isAdmin ? "Use the Add button to create holidays and events." : 'Holidays and events will appear here.'}
            />
          )}
        </div>
      )}

      {/* Day view — full event details for everyone; admins can edit/add from here. */}
      <AppDialog
        open={!!dayView}
        onOpenChange={(o) => (!o ? setDayView(null) : null)}
        title={dayView ? fmtDay(dayView) : ''}
        footer={
          isAdmin ? (
            <Button
              onClick={() => {
                const d = dayView;
                setDayView(null);
                setDialog({ mode: 'create', startYMD: d });
              }}
            >
              <Plus className="size-4" /> Add on this day
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setDayView(null)}>Close</Button>
          )
        }
      >
        {dayView ? (
          (byDate.get(dayView) ?? []).length ? (
            <ul className="divide-y divide-border/50 py-1">
              {(byDate.get(dayView) ?? []).map((ev) => {
                const t = EVENT_TYPES[ev.type] ?? EVENT_TYPES.EVENT;
                const inner = (
                  <>
                    <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', t.dot)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium break-words">{ev.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatRange(ev.startYMD, ev.endYMD)} · {t.label}
                      </p>
                      {ev.description ? (
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{ev.description}</p>
                      ) : null}
                    </div>
                  </>
                );
                return (
                  <li key={ev.occurrenceId || ev.id}>
                    {isAdmin ? (
                      <button
                        type="button"
                        className="flex w-full items-start gap-3 py-3 text-left transition-opacity hover:opacity-80"
                        onClick={() => {
                          setDayView(null);
                          setDialog({ mode: 'edit', holiday: ev });
                        }}
                      >
                        {inner}
                      </button>
                    ) : (
                      <div className="flex items-start gap-3 py-3">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-3 text-sm text-muted-foreground">Nothing on this day.</p>
          )
        ) : null}
      </AppDialog>

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
