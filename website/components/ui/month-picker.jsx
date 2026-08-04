'use client';

import * as React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { APP_LIVE_MONTH, monthLabel } from '@/lib/reward-periods';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A compact period picker that stays tidy no matter how many months pile up over the
 * years: two shortcuts (This month / All time) plus a year ◀▶ stepper over a 12-month
 * grid, instead of one ever-growing flat list. Months before the office went live or in
 * the future are disabled.
 *
 * `value`: 'this' | 'all' | 'YYYY-MM'. `onChange` gets the same. Picking the current month
 * from the grid resolves to 'this', so the live month always reads "This month".
 */
export function MonthPicker({ value, onChange, className }) {
  const now = new Date();
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth() + 1; // 1–12
  const [liveY, liveM] = APP_LIVE_MONTH.split('-').map(Number);
  const curYM = `${curY}-${String(curM).padStart(2, '0')}`;

  const isMonth = /^\d{4}-\d{2}$/.test(String(value));
  const label = value === 'all' ? 'All time' : value === 'this' || value === curYM ? 'This month' : monthLabel(value);

  const [open, setOpen] = React.useState(false);
  // Which year the grid shows — jumps to the selected month's year whenever it opens.
  const selYear = isMonth ? Number(String(value).slice(0, 4)) : curY;
  const [year, setYear] = React.useState(selYear);
  React.useEffect(() => { if (open) setYear(selYear); }, [open, selYear]);

  const pick = (v) => { onChange(v === curYM ? 'this' : v); setOpen(false); };
  const monthEnabled = (m) => {
    const ym = year * 100 + m;
    return ym >= liveY * 100 + liveM && ym <= curY * 100 + curM;
  };
  const monthSelected = (m) => {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    return value === ym || ((value === 'this' || value === curYM) && ym === curYM);
  };

  const quickCls = (active) =>
    cn('flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
      active ? 'bg-primary/15 text-primary ring-1 ring-primary/30' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className={cn('h-7 gap-1 text-xs', className)} />}>
        {label} <ChevronDown className="size-3.5 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 gap-0 p-2">
        <div className="flex gap-1">
          <button type="button" onClick={() => pick('this')} className={quickCls(value === 'this' || value === curYM)}>This month</button>
          <button type="button" onClick={() => pick('all')} className={quickCls(value === 'all')}>All time</button>
        </div>

        <div className="mt-2 mb-1 flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous year"
            disabled={year <= liveY}
            onClick={() => setYear((y) => y - 1)}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-semibold tabular-nums">{year}</span>
          <button
            type="button"
            aria-label="Next year"
            disabled={year >= curY}
            onClick={() => setYear((y) => y + 1)}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {MONTHS.map((name, i) => {
            const m = i + 1;
            const enabled = monthEnabled(m);
            const selected = monthSelected(m);
            return (
              <button
                key={name}
                type="button"
                disabled={!enabled}
                onClick={() => pick(`${year}-${String(m).padStart(2, '0')}`)}
                className={cn(
                  'rounded-md py-1.5 text-xs font-medium transition-colors',
                  selected ? 'bg-primary text-primary-foreground' : 'hover:bg-foreground/5',
                  !enabled && 'pointer-events-none opacity-30',
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
