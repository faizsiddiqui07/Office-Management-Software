'use client';

import { ArrowDownRight, ArrowUpRight, Minus, Tag, Wallet } from 'lucide-react';
import { GlassCard } from '@/components/glass/glass-card';
import { StatCardSkeleton } from '@/components/glass/skeletons';
import { cn } from '@/lib/utils';
import { categoryLabel, deltaVs, formatMoney, formatMoneyShort, PAYMENT_LABELS } from '@/lib/expense';

/**
 * A rise in spending is not automatically bad and a fall is not automatically good —
 * this is a petty-cash register, not a target. So the arrow is coloured by direction
 * only faintly, and the sentence states the comparison rather than judging it.
 */
function Delta({ current, previous, label }) {
  const d = deltaVs(current, previous?.total);
  if (!previous) return <span className="text-muted-foreground">No earlier period to compare</span>;
  if (previous.total === 0) {
    return <span className="text-muted-foreground">Nothing spent in {label || 'the previous period'}</span>;
  }
  if (!d || d.dir === 'flat') return <span className="inline-flex items-center gap-1 text-muted-foreground"><Minus className="size-3.5" /> Same as {label || 'before'}</span>;
  const Icon = d.dir === 'up' ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-1', d.dir === 'up' ? 'text-amber-600 dark:text-amber-300' : 'text-success')}>
      <Icon className="size-3.5" />
      {d.pct}% {d.dir === 'up' ? 'more' : 'less'} than {label || 'before'}
    </span>
  );
}

/** Cash vs UPI vs card — stored on every expense but, until now, shown nowhere. */
function PaymentMix({ rows = [], total }) {
  if (!rows.length || !total) return null;
  const top = rows.slice(0, 4);
  return (
    <GlassCard className="p-5">
      <h3 className="text-sm font-semibold">How it was paid</h3>
      <div className="mt-3 space-y-2.5">
        {top.map((r) => {
          const pct = Math.round((r.total / total) * 100);
          return (
            <div key={r.method}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate">{PAYMENT_LABELS[r.method] ?? r.method}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatMoneyShort(r.total)} <span className="text-xs">· {pct}%</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(pct, 2)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Useful for tallying the cash box at month end.</p>
    </GlassCard>
  );
}

export function ExpenseSummary({ summary, loading, stale }) {
  if (loading) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
    );
  }
  if (!summary) return null;

  const topCat = summary.byCategory?.[0];
  // byCategory deliberately ignores the category filter so the picker stays usable;
  // that makes it the wrong source for "the total", which must respect every filter.
  const total = summary.total ?? 0;

  return (
    <div className={cn('grid gap-4 lg:grid-cols-3', stale && 'opacity-70 transition-opacity')}>
      <GlassCard className="p-5 lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">Spent{summary.period?.label ? ` in ${summary.period.label}` : ''}</p>
            <p className="mt-0.5 text-3xl font-semibold tracking-tight tabular-nums">{formatMoneyShort(total)}</p>
            <p className="mt-1 text-sm">
              <Delta current={total} previous={summary.previous} label={summary.previousLabel} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{formatMoney(total)} exactly</p>
          </div>
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Wallet className="size-5" />
          </span>
        </div>

        {topCat ? (
          <div className="mt-4 flex items-center gap-2 border-t border-border/50 pt-3 text-sm">
            <Tag className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">Biggest category</span>
            <span className="ml-auto truncate font-medium">{categoryLabel(topCat.category)}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatMoneyShort(topCat.total)}</span>
          </div>
        ) : null}
      </GlassCard>

      <PaymentMix rows={summary.byMethod} total={(summary.byMethod ?? []).reduce((s, r) => s + r.total, 0)} />
    </div>
  );
}
