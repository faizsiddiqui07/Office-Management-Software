'use client';

import * as React from 'react';
import { Popover } from '@base-ui/react/popover';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildMonthGrid, todayYMDLocal } from '@/lib/calendar';
import { APP_LIVE_YMD } from '@/lib/app-live';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']; // buildMonthGrid starts weeks on Sunday

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
 *  - the year is a dropdown, so a 2002 date of birth doesn't take 288 taps to reach.
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
  const today = todayYMDLocal();

  // Where the calendar opens: the picked date, else today clamped into range.
  const anchor = value || (min && today < min ? min : max && today > max ? max : today);
  const [view, setView] = React.useState({ y: Number(anchor.slice(0, 4)), m: Number(anchor.slice(5, 7)) - 1 });
  React.useEffect(() => {
    if (open) setView({ y: Number(anchor.slice(0, 4)), m: Number(anchor.slice(5, 7)) - 1 });
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
  const years = [];
  for (let y = yearTo; y >= yearFrom; y -= 1) years.push(y);

  const cells = buildMonthGrid(view.y, view.m);
  const pick = (ymd) => {
    onChange(ymd);
    setOpen(false);
  };
  const todayAllowed = (!min || today >= min) && (!max || today <= max);

  const selectCls =
    'rounded-md bg-transparent px-1 py-0.5 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary/40';

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
                onClick={() => go(-1)}
                disabled={viewKey <= minKey}
                aria-label="Previous month"
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
              </button>
              <div className="flex items-center gap-0.5">
                <select
                  aria-label="Month"
                  value={view.m}
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    const k = Math.min(Math.max(view.y * 12 + m, minKey), maxKey);
                    setView({ y: Math.floor(k / 12), m: k % 12 });
                  }}
                  className={selectCls}
                >
                  {MONTHS.map((label, i) => {
                    const k = view.y * 12 + i;
                    return (
                      <option key={label} value={i} disabled={k < minKey || k > maxKey}>
                        {label}
                      </option>
                    );
                  })}
                </select>
                <select
                  aria-label="Year"
                  value={view.y}
                  onChange={(e) => {
                    const y = Number(e.target.value);
                    const k = Math.min(Math.max(y * 12 + view.m, minKey), maxKey);
                    setView({ y: Math.floor(k / 12), m: k % 12 });
                  }}
                  className={cn(selectCls, 'tabular-nums')}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => go(1)}
                disabled={viewKey >= maxKey}
                aria-label="Next month"
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

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
