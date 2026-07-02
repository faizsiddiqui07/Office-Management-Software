'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { GlassCard } from '@/components/glass/glass-card';
import { formatMoney, categoryLabel, currentYearRange, monthLabelShort } from '@/lib/expense';

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6', '#ef4444'];

const tooltipStyle = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: '10px',
  fontSize: '12px',
  color: 'var(--popover-foreground)',
};

function Empty() {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data yet</div>;
}

export function ExpenseCharts() {
  const { from, to, label } = currentYearRange();
  const { data } = useQuery({
    queryKey: ['expenses', 'summary', from, to],
    queryFn: () => api.get(`/expenses/summary?from=${from}&to=${to}`),
  });

  const byCategory = (data?.byCategory ?? []).map((c) => ({ name: categoryLabel(c.category), value: c.total }));
  const byMonth = (data?.byMonth ?? []).map((m) => ({ name: monthLabelShort(m.month), total: m.total }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <GlassCard className="p-5">
        <h3 className="text-sm font-semibold">By category</h3>
        <div className="mt-2 h-64 text-muted-foreground">
          {byCategory.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {byCategory.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="none" />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatMoney(v)} contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </div>
        {byCategory.length ? (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {byCategory.map((c, i) => (
              <span key={c.name} className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                {c.name}
              </span>
            ))}
          </div>
        ) : null}
      </GlassCard>

      <GlassCard className="p-5">
        <h3 className="text-sm font-semibold">Monthly · {label}</h3>
        <div className="mt-2 h-64 text-muted-foreground">
          {byMonth.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMonth} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'currentColor' }} />
                <YAxis
                  tickFormatter={(v) => `₹${Math.round(v / 100000)}k`}
                  tickLine={false}
                  axisLine={false}
                  width={42}
                  tick={{ fontSize: 11, fill: 'currentColor' }}
                />
                <Tooltip formatter={(v) => formatMoney(v)} cursor={{ fill: 'rgba(127,127,127,0.08)' }} contentStyle={tooltipStyle} />
                <Bar dataKey="total" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </div>
      </GlassCard>
    </div>
  );
}
