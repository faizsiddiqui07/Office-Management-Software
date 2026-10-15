'use client';

import * as React from 'react';
import { ArrowDownUp } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * "Sort by …" for the CARD lists — the ones that aren't a DataTable and so have
 * no column headers to tap (corrections history, the announcement feed).
 *
 * Each option carries its own comparator AND spells its direction out in the
 * label ("Newest first", not "Date" with an arrow parked somewhere else). On a
 * list of cards there is no column for an arrow to point at, so the words have
 * to carry the direction. The DataTable is the other half of this: there the
 * control picks a COLUMN and a separate toggle flips the direction, because the
 * header arrows mean the same thing and the two must not contradict each other.
 *
 * Re-ordering happens in the browser on rows that are already here — both feeds
 * arrive whole (the server caps them at 100) — so there is no round trip, and
 * no chance of the list coming back in an order the screen doesn't show.
 */
export function SortSelect({ value, onChange, options, className, ariaLabel = 'Sort' }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel} className={cn('h-9 w-full bg-background/50 sm:w-60', className)}>
        <ArrowDownUp className="size-4 shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The rows in the chosen order, as a COPY.
 *
 * Sorting the array react-query handed over would reorder the CACHE in place:
 * every other component reading that same query would silently inherit this
 * screen's choice, and a re-render with no refetch would never put it back.
 */
export function sortRows(rows, options, value) {
  const compare = options.find((o) => o.value === value)?.compare;
  return compare ? [...rows].sort(compare) : rows;
}

const stamp = (v) => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Compare on a date/instant. A row without one sorts LAST in both directions —
 * treating "no date" as 1970 would float exactly the rows with nothing to show
 * to the top of a newest-first list, which is the one thing nobody means by it.
 */
export function byTime(pick, dir = 'desc') {
  return (a, b) => {
    const ta = stamp(pick(a));
    const tb = stamp(pick(b));
    if (ta === null || tb === null) return ta === tb ? 0 : ta === null ? 1 : -1;
    return dir === 'asc' ? ta - tb : tb - ta;
  };
}

/** Compare on a 'YYYY-MM-DD' string — for that shape, text order IS date order. */
export function byYMD(pick, dir = 'desc') {
  return (a, b) => {
    const x = pick(a) || '';
    const y = pick(b) || '';
    if (x === y) return 0;
    if (!x || !y) return x ? -1 : 1;
    if (dir === 'asc') return x < y ? -1 : 1;
    return x < y ? 1 : -1;
  };
}

/** Compare on a name/title — case- and accent-insensitive, blanks last. */
export function byText(pick) {
  return (a, b) => {
    const x = String(pick(a) ?? '').trim();
    const y = String(pick(b) ?? '').trim();
    if (!x || !y) return x === y ? 0 : x ? -1 : 1;
    return x.localeCompare(y, undefined, { sensitivity: 'base' });
  };
}

/**
 * Run comparators in order; the first one with an opinion wins.
 *
 * Every option ends in a tie-breaker that is unique-ish (a timestamp), so two
 * rows that match on the visible key still come out in a fixed order instead of
 * swapping places between renders.
 */
export function thenBy(...comparators) {
  return (a, b) => {
    for (const c of comparators) {
      const r = c(a, b);
      if (r) return r;
    }
    return 0;
  };
}
