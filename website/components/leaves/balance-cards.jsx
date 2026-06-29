'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarX, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { GlassCard } from '@/components/glass/glass-card';
import { StatCard } from '@/components/glass/stat-card';
import { formatDuration } from '@/lib/time';

export function BalanceCards() {
  const { data } = useQuery({
    queryKey: ['leaves', 'balance'],
    queryFn: () => api.get('/leaves/balance'),
  });

  const bal = data?.balance;
  const total = bal?.totalQuota ?? 18;
  const used = bal?.used ?? 0;
  const remaining = bal?.remaining ?? total;
  const overtime = bal?.overtimeMinutes ?? 0;

  const r = 52;
  const circ = 2 * Math.PI * r;
  const frac = total ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const offset = circ * (1 - frac);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <GlassCard className="flex items-center gap-5 p-5 sm:col-span-2">
        <svg width="120" height="120" viewBox="0 0 120 120" className="-rotate-90 shrink-0">
          <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-border" />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            className="stroke-primary transition-[stroke-dashoffset] duration-700"
            strokeDasharray={circ}
            strokeDashoffset={offset}
          />
        </svg>
        <div>
          <p className="text-sm text-muted-foreground">Remaining leaves</p>
          <p className="text-4xl font-semibold tabular-nums">
            {remaining}
            <span className="text-lg font-normal text-muted-foreground"> / {total}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{used} used this year</p>
        </div>
      </GlassCard>

      <StatCard label="Used" value={used} icon={CalendarX} tone="warning" hint={`of ${total} quota`} />
      <StatCard label="Overtime accrued" value={formatDuration(overtime)} icon={Clock} tone="info" />
    </div>
  );
}
