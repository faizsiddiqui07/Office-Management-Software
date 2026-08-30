'use client';

import * as React from 'react';
import { Popover } from '@base-ui/react/popover';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildMonthGrid, todayYMDLocal } from '@/lib/calendar';
import { APP_LIVE_YMD } from '@/lib/app-live';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']; // buildMonthGrid starts weeks on Sunday
const YEARS_PER_PAGE = 12;

const monthKey = (ymd) => Number(ymd.slice(0, 4)) * 12 + (Number(ymd.slice(5, 7)) - 1);

/** "2026-07-22" → "22 Jul 2026" (UTC-pinned so no device timezone can shift the day). */
export function formatPickedDate(ymd) {
  if (!ymd) return '';
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The app's date picker — a styled calendar instead of the bare native input.
 *
 * Two things the native control couldn't give us:
 *  - out-of-range days render greyed out IN the calendar, so "you can't pick before
 *    1 July 2026" is something people see rather than a silent refusal;
 *  - tapping the caption drops into a month grid, and again into a year grid, so a
 *    2002 date of birth is three taps rather than 288. These are panels INSIDE the
 *    calendar, not dropdowns: a native <select> renders in OS chrome — white, boxy,
 *    ignoring the app's theme entirely — and nesting another popup inside a popover
 *    is a trap on mobile.
 *
 * Controlled: `value` is a yyyy-MM-dd string or ''. `min`/`max` bound both the grid
 * and the month navigation. No default floor here — the caller decides, because a
 * date of birth and an attendance filter need opposite ranges.
 */
export function DatePicker({
  value = '',
  onChange,
  min = '',
  max = '',
  placeholder = 'Pick a date',
  clearable = false,
  disabled = false,
  id,
  className,
  align = 'start',
  ...rest // aria-label and friends, straight onto the trigger button
}) {
  const [open, setOpen] = React.useState(false);
  // 'days' → the calendar; 'months' → pick a month in the shown year; 'years' → a page
  // of years. Each step back up is one tap on the caption.
  const [mode, setMode] = React.useState('days');
  const today = todayYMDLocal();

  // Where the calendar opens: the picked date, else today clamped into range.
  const anchor = value || (min && today < min ? min : max && today > max ? max : today);
  const [view, setView] = React.useState({ y: Number(anchor.slice(0, 4)), m: Number(anchor.slice(5, 7)) - 1 });
  React.useEffect(() => {
    if (open) {
      setView({ y: Number(anchor.slice(0, 4)), m: Number(anchor.slice(5, 7)) - 1 });
      setMode('days');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const yearFrom = min ? Number(min.slice(0, 4)) : 1950;
  const yearTo = max ? Number(max.slice(0, 4)) : Number(today.slice(0, 4)) + 10;

  const viewKey = view.y * 12 + view.m;
  // With no min/max the chevrons still stop at the year dropdown's ends — otherwise
  // arrow past 1950 and the dropdown sits on a year the view has already left.
  const minKey = min ? monthKey(min) : yearFrom * 12;
  const maxKey = max ? monthKey(max) : yearTo * 12 + 11;
  const go = (delta) => {
    const k = Math.min(Math.max(viewKey + delta, minKey), maxKey);
    setView({ y: Math.floor(k / 12), m: k % 12 });
  };

  // The year page currently on screen, anchored so the shown year is always in it.
  // Math.max keeps a value that sits below yearFrom (possible when no min is given)
  // from paging backwards past the start of the list.
  const pageStart = yearFrom + Math.max(0, Math.floor((view.y - yearFrom) / YEARS_PER_PAGE)) * YEARS_PER_PAGE;
  const yearPage = [];
  for (let y = pageStart; y < pageStart + YEARS_PER_PAGE && y <= yearTo; y += 1) yearPage.push(y);

  // What the ‹ › chevrons step, and whether they can: a month, a year, or a year page.
  const step = mode === 'days' ? 1 : mode === 'months' ? 12 : YEARS_PER_PAGE * 12;
  const canPrev = mode === 'years' ? pageStart > yearFrom : viewKey - step >= minKey;
  const canNext = mode === 'years' ? pageStart + YEARS_PER_PAGE <= yearTo : viewKey + step <= maxKey;
  const stepBy = (dir) => {
    if (mode === 'years') setView((v) => ({ ...v, y: Math.min(Math.max(v.y + dir * YEARS_PER_PAGE, yearFrom), yearTo) }));
    else go(dir * step);
  };

  const cells = buildMonthGrid(view.y, view.m);
  const pick = (ymd) => {
    onChange(ymd);
    setOpen(false);
  };
  const todayAllowed = (!min || today >= min) && (!max || today <= max);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        render={
          <button
            id={id}
            type="button"
            {...rest}
            className={cn(
              'flex h-9 w-full items-center gap-2 rounded-lg border border-input px-3 text-left text-sm transition-[color,border-color,box-shadow] outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
          >
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
            {value ? (
              <span className="truncate tabular-nums">{formatPickedDate(value)}</span>
            ) : (
              <span className="truncate text-muted-foreground">{placeholder}</span>
            )}
          </button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align={align} sideOffset={6} className="isolate z-50">
          <Popover.Popup className="w-[19rem] rounded-xl bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={() => stepBy(-1)}
                disabled={!canPrev}
                aria-label="Previous"
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
              </button>
              {/* The caption is the control: days → months → years, one tap each. */}
              <button
                type="button"
                onClick={() => setMode(mode === 'days' ? 'months' : mode === 'months' ? 'years' : 'days')}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm font-semibold transition-colors hover:bg-foreground/5"
              >
                <span className="tabular-nums">
                  {mode === 'days' ? `${MONTHS[view.m]} ${view.y}` : mode === 'months' ? view.y : `${yearPage[0]} – ${yearPage[yearPage.length - 1]}`}
                </span>
                <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', mode !== 'days' && 'rotate-180')} />
              </button>
              <button
                type="button"
                onClick={() => stepBy(1)}
                disabled={!canNext}
                aria-label="Next"
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            {mode === 'days' ? (
              <div className="mt-2 grid grid-cols-7 text-center">
                {WEEKDAYS.map((d) => (
                  <span key={d} className="py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {d}
                  </span>
                ))}
                {cells.map((c) => {
                  const off = (min && c.ymd < min) || (max && c.ymd > max);
                  const sel = c.ymd === value;
                  const isToday = c.ymd === today;
                  return (
                    <button
                      key={c.ymd}
                      type="button"
                      disabled={off}
                      onClick={() => pick(c.ymd)}
                      aria-label={c.ymd}
                      className={cn(
                        'mx-auto flex size-9 items-center justify-center rounded-lg text-sm tabular-nums transition-colors',
                        sel
                          ? 'bg-primary font-semibold text-primary-foreground'
                          : off
                            ? 'cursor-not-allowed text-muted-foreground/30'
                            : c.inMonth
                              ? 'hover:bg-foreground/8'
                              : 'text-muted-foreground/50 hover:bg-foreground/5',
                        isToday && !sel && 'ring-1 ring-inset ring-primary/50',
                      )}
                    >
                      {c.date.getDate()}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {mode === 'months' ? (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {MONTHS_SHORT.map((label, i) => {
                  const k = view.y * 12 + i;
                  const off = k < minKey || k > maxKey;
                  const sel = !!value && Number(value.slice(0, 4)) === view.y && Number(value.slice(5, 7)) - 1 === i;
                  return (
                    <button
                      key={label}
                      type="button"
                      disabled={off}
                      aria-label={`${MONTHS[i]} ${view.y}`}
                      onClick={() => {
                        setView({ y: view.y, m: i });
                        setMode('days');
                      }}
                      className={cn(
                        'rounded-lg py-2 text-sm transition-colors',
                        sel ? 'bg-primary font-semibold text-primary-foreground' : off ? 'cursor-not-allowed text-muted-foreground/30' : 'hover:bg-foreground/8',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {mode === 'years' ? (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {yearPage.map((y) => {
                  // A year is reachable if any of its months is.
                  const off = y * 12 + 11 < minKey || y * 12 > maxKey;
                  const sel = !!value && Number(value.slice(0, 4)) === y;
                  return (
                    <button
                      key={y}
                      type="button"
                      disabled={off}
                      onClick={() => {
                        setView((v) => ({ ...v, y }));
                        setMode('months');
                      }}
                      className={cn(
                        'rounded-lg py-2 text-sm tabular-nums transition-colors',
                        sel ? 'bg-primary font-semibold text-primary-foreground' : off ? 'cursor-not-allowed text-muted-foreground/30' : 'hover:bg-foreground/8',
                      )}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-2 flex items-center justify-between border-t border-border/50 pt-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => todayAllowed && pick(today)}
                  disabled={!todayAllowed}
                  className="rounded-md px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Today
                </button>
                {/* A real button in the footer, not a control nested inside the trigger
                    button — that was invalid ARIA and unreachable by keyboard. */}
                {clearable && value ? (
                  <button
                    type="button"
                    onClick={() => {
                      onChange('');
                      setOpen(false);
                    }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                  >
                    <X className="size-3" /> Clear
                  </button>
                ) : null}
              </div>
              {/* Explain the floor only when it IS the app's floor — a date of birth
                  bounded at 1940 needs no such caption. */}
              {min === APP_LIVE_YMD ? (
                <span className="text-[11px] text-muted-foreground">Records start {formatPickedDate(min)}</span>
              ) : (
                <span />
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
