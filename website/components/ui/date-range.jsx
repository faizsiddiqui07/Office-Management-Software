'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * A compact "from → to" date range for filter bars. Two native date pickers
 * (which open the OS calendar on tap), so people can pick "x date se x date tak".
 *
 * Controlled: `value = { from, to }` (YMD strings, '' when unset), `onChange(next)`.
 * Clearing both means "no range". `max` caps both (e.g. today).
 */
export function DateRange({ value, onChange, className, max }) {
  const from = value?.from || '';
  const to = value?.to || '';
  const active = from || to;
  return (
    <div className={cn('flex w-full items-center gap-1.5 sm:w-auto', className)}>
      <Input
        type="date"
        aria-label="From date"
        value={from}
        max={to || max}
        onChange={(e) => onChange({ from: e.target.value, to })}
        className="h-9 min-w-0 flex-1 bg-background/50 sm:w-40 sm:flex-none"
      />
      <span className="shrink-0 text-xs text-muted-foreground" aria-hidden="true">→</span>
      <Input
        type="date"
        aria-label="To date"
        value={to}
        min={from}
        max={max}
        onChange={(e) => onChange({ from, to: e.target.value })}
        className="h-9 min-w-0 flex-1 bg-background/50 sm:w-40 sm:flex-none"
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
