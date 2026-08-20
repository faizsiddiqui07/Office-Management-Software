'use client';

import { cn } from '@/lib/utils';

// Tone-tinted icon chip per stat kind — kept subtle so a wall of them stays calm.
const TILE_TONE = {
  default: 'bg-primary/10 text-primary ring-primary/20',
  success: 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400',
  warning: 'bg-amber-500/12 text-amber-600 ring-amber-500/25 dark:text-amber-300',
  info: 'bg-sky-500/12 text-sky-600 ring-sky-500/25 dark:text-sky-400',
  destructive: 'bg-red-500/12 text-red-600 ring-red-500/25 dark:text-red-400',
};

/**
 * A compact summary stat. Vertical layout — icon + label on top, the number on its own
 * full-width line below — so a value like "3h 18m" is never broken mid-word the way it is
 * when it has to share a row with the icon. Acts as a filter toggle when `onClick` is
 * given (the selected one gets a ring); otherwise it's a plain readout. Used by the
 * attendance overview and the visitors "still in office" / "expected" tiles.
 */
export function StatTile({ label, value, icon: Icon, tone = 'default', hint, active, onClick, className }) {
  const clickable = typeof onClick === 'function';
  const Comp = clickable ? 'button' : 'div';
  return (
    <Comp
      type={clickable ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={clickable ? !!active : undefined}
      className={cn(
        'group flex h-full w-full flex-col justify-between gap-3 rounded-2xl border border-border/50 bg-card/60 p-3.5 text-left shadow-sm ring-1 ring-transparent transition-colors sm:p-4',
        clickable && 'hover:border-border hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        active && 'border-primary/60 !ring-primary/50',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium leading-tight text-muted-foreground sm:text-[13px]">{label}</span>
        {Icon ? (
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 sm:size-9', TILE_TONE[tone] || TILE_TONE.default)}>
            <Icon className="size-4 sm:size-[18px]" />
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <p className="text-[26px] font-semibold leading-none tracking-tight tabular-nums sm:text-3xl">{value}</p>
        {hint ? <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </Comp>
  );
}
