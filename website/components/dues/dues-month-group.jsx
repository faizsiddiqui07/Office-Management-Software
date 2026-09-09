'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { formatMoney } from '@/lib/expense';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { SORTS } from '@/lib/dues-history';

/**
 * The month-section chrome for a dues ledger, shared by "My dues" and the admin's
 * per-person panel so the two can never drift into showing the same money differently.
 * The grouping arithmetic itself lives in lib/dues-history.js.
 */

export { groupByMonth, SORTS } from '@/lib/dues-history';

/**
 * A month's heading: its name, what it cost, and a fold toggle.
 *
 * Sticky, so while you scroll a long month you can still see which one you are in —
 * the whole point of splitting the history up. `top` is passed in because the two
 * places this is used sit under different amounts of sticky chrome.
 */
export function MonthHeading({ month, open, onToggle, top = 'top-0' }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        'sticky z-10 -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg bg-background/80 px-2 py-2 text-left backdrop-blur transition-colors hover:bg-foreground/5',
        top,
      )}
    >
      <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} />
      <span className="text-sm font-semibold tracking-tight">{month.label}</span>
      <span className="text-xs text-muted-foreground">
        {month.entries.length} {month.entries.length === 1 ? 'entry' : 'entries'}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-3 text-xs tabular-nums">
        {month.added ? (
          <span className="text-amber-600 dark:text-amber-300">−{formatMoney(month.added)}</span>
        ) : null}
        {month.received ? <span className="text-success">+{formatMoney(month.received)}</span> : null}
        {/* Settled cash is money in too, but it is already spent on the items it cleared —
            so it is shown apart from credit rather than added to it. */}
        {month.settled ? (
          <span className="text-success/80" title="Items paid off directly">
            ✓{formatMoney(month.settled)}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Which months are folded. Everything is open except, once there is more than one
 * month, the older ones — the current month is what people came for, and a year of
 * lunch entries expanded underneath it is a scroll nobody asked for.
 */
export function useMonthFolds(months) {
  const [closed, setClosed] = React.useState(null); // null = not decided yet
  const firstKey = months[0]?.key;
  const signature = months.map((m) => m.key).join(',');

  React.useEffect(() => {
    // Re-decided when the set of months changes (a new month, or a re-sort), but never
    // on every render — otherwise a fold the user just opened would snap shut.
    setClosed(months.length > 1 ? new Set(months.slice(1).map((m) => m.key)) : new Set());
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const isOpen = (key) => (closed ? !closed.has(key) : key === firstKey || months.length <= 1);
  const toggle = (key) =>
    setClosed((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allOpen = !!closed && closed.size === 0;
  const setAll = (open) => setClosed(open ? new Set() : new Set(months.map((m) => m.key)));

  return { isOpen, toggle, allOpen, setAll };
}

/** The order picker, identical in both history lists. */
export function SortSelect({ value, onChange, options = SORTS, className }) {
  const current = options.find((o) => o.key === value) || options[0];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('h-8 w-[10.5rem] bg-background/50', className)}>
        <span className="truncate text-sm">{current?.label}</span>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
