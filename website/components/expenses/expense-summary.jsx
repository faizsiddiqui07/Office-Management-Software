'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarRange, Tag, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { StatCard } from '@/components/glass/stat-card';
import { StatCardSkeleton } from '@/components/glass/skeletons';
import { formatMoney, categoryLabel, currentYearRange, currentMonthKey } from '@/lib/expense';

export function ExpenseSummary() {
  const { from, to, label } = currentYearRange();
  const { data, isLoading } = useQuery({
    queryKey: ['expenses', 'summary', from, to],
    queryFn: () => api.get(`/expenses/summary?from=${from}&to=${to}`),
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
    );
  }

  const thisMonth = data?.byMonth?.find((m) => m.month === currentMonthKey())?.total ?? 0;
  const topCat = data?.byCategory?.[0];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="This month" value={formatMoney(thisMonth)} icon={Wallet} tone="default" />
      <StatCard label={label} value={formatMoney(data?.total ?? 0)} icon={CalendarRange} tone="info" hint={`${data?.count ?? 0} entries · Apr–Mar`} />
      <StatCard
        label="Top category"
        value={topCat ? categoryLabel(topCat.category) : '—'}
        icon={Tag}
        tone="warning"
        hint={topCat ? formatMoney(topCat.total) : ''}
      />
    </div>
  );
}
