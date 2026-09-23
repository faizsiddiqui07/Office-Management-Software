'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

const toneIcon = {
  default: 'bg-primary/12 text-primary ring-primary/20',
  success: 'bg-success/12 text-success ring-success/20',
  warning: 'bg-warning/15 text-amber-600 ring-warning/25 dark:text-amber-300',
  info: 'bg-info/12 text-info ring-info/20',
  destructive: 'bg-destructive/12 text-destructive ring-destructive/20',
};

/**
 * `compact` is for a row of MANY tiles (the user dossier has seven): smaller padding,
 * icon and figure, and the figure on one line — at full size a seven-across row broke
 * "From home" over two lines and "3h 13m" over three.
 */
export function StatCard({ label, value, icon: Icon, hint, tone = 'default', trend, compact = false, className }) {
  const reduce = useReducedMotion();
  const TrendIcon =
    trend?.direction === 'up' ? ArrowUpRight : trend?.direction === 'down' ? ArrowDownRight : Minus;
  const trendColor =
    trend?.direction === 'up'
      ? 'text-success'
      : trend?.direction === 'down'
        ? 'text-destructive'
        : 'text-muted-foreground';

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={cn('glass glass-highlight rounded-2xl', compact ? 'p-4' : 'p-5', className)}
    >
      <div className={cn('flex items-start justify-between', compact ? 'gap-2' : 'gap-3')}>
        <div className="min-w-0 space-y-1">
          <p className={cn('font-medium text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>{label}</p>
          <p
            className={cn(
              'font-semibold tracking-tight tabular-nums',
              compact ? 'whitespace-nowrap text-xl' : 'break-words text-2xl sm:text-3xl',
            )}
          >
            {value}
          </p>
        </div>
        {Icon ? (
          <span
            className={cn(
              'flex shrink-0 items-center justify-center rounded-xl ring-1',
              compact ? 'size-9' : 'size-11',
              toneIcon[tone],
            )}
          >
            <Icon className={compact ? 'size-4' : 'size-5'} />
          </span>
        ) : null}
      </div>

      {(trend || hint) && (
        <div className={cn('flex items-center gap-2', compact ? 'mt-2.5 text-xs' : 'mt-4 text-sm')}>
          {trend ? (
            <span className={cn('inline-flex items-center gap-0.5 font-medium', trendColor)}>
              <TrendIcon className="size-4" />
              {trend.value}
            </span>
          ) : null}
          {hint ? <span className="text-muted-foreground">{hint}</span> : null}
        </div>
      )}
    </motion.div>
  );
}
