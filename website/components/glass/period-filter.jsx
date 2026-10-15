'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { DateRange } from '@/components/ui/date-range';
import { ALL_TIME, PERIOD_PRESETS } from '@/lib/date-period';

/**
 * The date window picker every list shares: a row of chips, and the two date
 * boxes only once "Custom" is chosen.
 *
 * Chips, not a dropdown. The whole point of these is that the common windows
 * are one tap away — behind a dropdown they are three. This is also the shape
 * Expenses and Approvals already use, so the app only ever asks for a period in
 * one visual language. (Sorting is a dropdown for the opposite reason: six
 * options that each need a sentence.)
 *
 * `value` is `{ preset, from, to }` and the parent owns it. Switching away from
 * Custom CLEARS the typed dates rather than remembering them: a chip that says
 * "This month" while yesterday's custom range is still filtering underneath is
 * the kind of lie that costs an hour to notice.
 *
 * Pass `showCustomRange={false}` on a screen that already has its own From/To
 * boxes (Activity, Visitors) — there the chips just fill those in, and a second
 * pair here would be two controls fighting over the same filter.
 */
export function PeriodFilter({
  value,
  onChange,
  presets,
  showCustomRange = true,
  className,
  min,
  max,
}) {
  const period = value || ALL_TIME;
  const options = presets ? PERIOD_PRESETS.filter((p) => presets.includes(p.value)) : PERIOD_PRESETS;

  const pick = (v) => {
    if (v === 'custom') {
      // Keep whatever dates are already typed, so re-tapping Custom doesn't wipe them.
      onChange({ preset: 'custom', from: period.from || '', to: period.to || '' });
      return;
    }
    onChange({ preset: v, from: '', to: '' });
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap gap-1.5">
        {options.map((p) => {
          const on = period.preset === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => pick(p.value)}
              aria-pressed={on}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors',
                on
                  ? 'bg-primary text-primary-foreground ring-primary'
                  : 'bg-background/40 text-muted-foreground ring-border hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {showCustomRange && period.preset === 'custom' ? (
        <DateRange
          value={{ from: period.from, to: period.to }}
          onChange={(r) => onChange({ preset: 'custom', from: r.from, to: r.to })}
          min={min}
          max={max}
        />
      ) : null}
    </div>
  );
}
