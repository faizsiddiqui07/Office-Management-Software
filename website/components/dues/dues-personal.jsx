'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, HandCoins, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/expense';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/glass/page-header';
import { GlassCard } from '@/components/glass/glass-card';
import { GlassPanel } from '@/components/glass/glass-panel';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const TONES = {
  warning: 'bg-warning/12 text-amber-600 ring-warning/25 dark:text-amber-300',
  success: 'bg-success/12 text-success ring-success/20',
  muted: 'bg-muted/50 text-muted-foreground ring-border',
};

function BalanceHero({ pending, advance }) {
  let tone = 'muted';
  let Icon = CheckCircle2;
  let label = 'All settled';
  let value = formatMoney(0);
  let hint = 'You don’t owe anything right now.';

  if (advance > 0) {
    tone = 'success';
    Icon = Wallet;
    label = 'Advance balance';
    value = formatMoney(advance);
    hint = 'You’ve paid ahead — future dues are deducted from this.';
  } else if (pending > 0) {
    tone = 'warning';
    Icon = ArrowUpRight;
    label = 'You owe the admin';
    value = formatMoney(pending);
    hint = 'Pay the admin manager in cash — they’ll mark it here.';
  }

  return (
    <GlassPanel className="flex items-center gap-5 p-6">
      <span className={cn('flex size-14 shrink-0 items-center justify-center rounded-2xl ring-1', TONES[tone])}>
        <Icon className="size-7" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
    </GlassPanel>
  );
}

function EntryRow({ e }) {
  const isDue = e.kind === 'DUE';
  const paid = isDue && e.status === 'PAID';
  const partial = isDue && e.status === 'PARTIAL';
  return (
    <div className="flex items-center gap-3 p-3">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl ring-1',
          !isDue || paid ? TONES.success : TONES.warning,
        )}
      >
        {!isDue ? <ArrowUpRight className="size-4" /> : paid ? <CheckCircle2 className="size-4" /> : <ArrowDownLeft className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {isDue ? e.item || 'Item' : e.note || 'Payment / advance'}
          {isDue && e.source ? <span className="font-normal text-muted-foreground"> · {e.source}</span> : null}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{fmtDate(e.date)}</span>
          {isDue ? (
            paid ? (
              <span className="font-medium text-success">Paid</span>
            ) : partial ? (
              <span className="font-medium text-amber-600 dark:text-amber-300">Partial · {formatMoney(e.remaining)} left</span>
            ) : (
              <span className="font-medium text-amber-600 dark:text-amber-300">Pending</span>
            )
          ) : (
            <span>Advance / credit</span>
          )}
        </div>
      </div>
      <span className={cn('shrink-0 text-sm font-semibold tabular-nums', !isDue ? 'text-success' : paid ? 'text-muted-foreground line-through' : 'text-amber-600 dark:text-amber-300')}>
        {isDue ? '−' : '+'}
        {formatMoney(e.amount)}
      </span>
    </div>
  );
}

export function DuesPersonal() {
  const { data, isLoading } = useQuery({ queryKey: ['dues', 'me'], queryFn: () => api.get('/dues/me') });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Dues"
        title="My dues"
        icon={HandCoins}
        description="What you owe the office admin for lunch, tea, and errands — and any advance you’ve paid."
      />

      {isLoading || !data ? (
        <LoadingState label="Loading your dues…" />
      ) : (
        <>
          <BalanceHero pending={data.pending} advance={data.advance} />

          <section className="space-y-3">
            <h2 className="px-1 text-lg font-semibold tracking-tight">History</h2>
            {data.entries.length ? (
              <GlassCard className="divide-y divide-border/50 p-2">
                {data.entries.map((e) => (
                  <EntryRow key={e.id} e={e} />
                ))}
              </GlassCard>
            ) : (
              <EmptyState icon={HandCoins} title="Nothing here yet" description="When the admin adds a lunch or errand for you, it’ll show up here." />
            )}
          </section>
        </>
      )}
    </div>
  );
}
