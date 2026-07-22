'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/ui/date-picker';
import { APP_LIVE_YMD } from '@/lib/app-live';

/**
 * A compact "from → to" date range for filter bars, on the app's own calendar
 * popover. Controlled: `value = { from, to }` (YMD strings, '' when unset).
 *
 * Every DateRange in the app is a DATA filter (expenses, tasks, reports…), so the
 * floor defaults to the day the system went live — nothing exists before it, and
 * offering earlier dates only produced empty months that read as "everyone absent".
 * Pass a different `min` for the rare screen that needs one.
 */
export function DateRange({ value, onChange, className, min = APP_LIVE_YMD, max }) {
  const from = value?.from || '';
  const to = value?.to || '';
  const active = from || to;
  return (
    <div className={cn('flex w-full items-center gap-1.5 sm:w-auto', className)}>
      <DatePicker
        aria-label="From date"
        value={from}
        min={min}
        max={to || max}
        placeholder="From"
        onChange={(v) => onChange({ from: v, to })}
        className="min-w-0 flex-1 bg-background/50 sm:w-40 sm:flex-none"
      />
      <span className="shrink-0 text-xs text-muted-foreground" aria-hidden="true">→</span>
      <DatePicker
        aria-label="To date"
        value={to}
        min={from || min}
        max={max}
        placeholder="To"
        onChange={(v) => onChange({ from, to: v })}
        className="min-w-0 flex-1 bg-background/50 sm:w-40 sm:flex-none"
      />
      {active ? (
        <button
          type="button"
          onClick={() => onChange({ from: '', to: '' })}
          aria-label="Clear date range"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
