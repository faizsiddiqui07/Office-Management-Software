'use client';

import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GlassCard } from '@/components/glass/glass-card';
import { cn } from '@/lib/utils';
import { categoryColor, categoryLabel, formatAxisMoney, formatMoney, formatMoneyShort, monthLabelShort } from '@/lib/expense';

const tooltipStyle = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: '10px',
  fontSize: '12px',
  color: 'var(--popover-foreground)',
};

function Empty({ children = 'No spending in this period' }) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{children}</div>;
}

/**
 * Both charts are inputs, not decoration: tapping a slice filters to that category,
 * tapping a bar drills into that month. Tapping the same one again clears it, and the
 * scope line above carries a removable chip for whatever is active.
 */
export function ExpenseCharts({ summary, filters, onChange }) {
  const set = (patch) => onChange({ ...filters, ...patch });

  const byCategory = (summary?.byCategory ?? []).map((c) => ({
    key: c.category,
    name: categoryLabel(c.category),
    value: c.total,
  }));
  const catTotal = byCategory.reduce((s, c) => s + c.value, 0);

  const trend = (summary?.trend ?? []).map((m) => ({ key: m.month, name: monthLabelShort(m.month), total: m.total }));
  const trendTotal = trend.reduce((s, m) => s + m.total, 0);

  const activeCat = filters.category !== 'ALL' ? filters.category : null;
  const activeMonth = filters.preset === 'month' ? filters.monthKey : null;

  const pickCategory = (key) => set({ category: activeCat === key ? 'ALL' : key });
  const pickMonth = (key) => (activeMonth === key ? set({ preset: 'this_fy', monthKey: '' }) : set({ preset: 'month', monthKey: key }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <GlassCard className="p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Where it went</h3>
          {/* Any surface wider than the scope line prints its own total, so a chart
              can never be read against the wrong number. */}
          <span className="text-xs tabular-nums text-muted-foreground">{formatMoneyShort(catTotal)}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {activeCat ? 'Showing one category — tap it again to see them all.' : 'Tap a slice to filter.'}
        </p>
        <div className="mt-2 h-56 text-muted-foreground">
          {byCategory.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={byCategory}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={2}
                  onClick={(d) => pickCategory(d?.payload?.key ?? d?.key)}
                  className="cursor-pointer focus:outline-none"
                >
                  {byCategory.map((c) => (
                    <Cell
                      key={c.key}
                      fill={categoryColor(c.key)}
                      stroke="none"
                      fillOpacity={activeCat && activeCat !== c.key ? 0.25 : 1}
                    />
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
          <div className="mt-2 flex flex-wrap gap-1.5">
            {byCategory.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => pickCategory(c.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs ring-1 transition-colors',
                  activeCat === c.key ? 'bg-primary/10 text-primary ring-primary/25' : 'text-muted-foreground ring-transparent hover:bg-foreground/5',
                )}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(c.key) }} />
                {c.name}
                <span className="tabular-nums opacity-70">{formatMoneyShort(c.value)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </GlassCard>

      <GlassCard className="p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Last 12 months</h3>
          <span className="text-xs tabular-nums text-muted-foreground">{formatMoneyShort(trendTotal)}</span>
        </div>
        {/* This window deliberately ignores the chosen period. Binding it would turn
            "This month" into a chart with exactly one bar, which answers nothing —
            the point of a trend is telling you whether this month is unusual. */}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {activeMonth ? 'Drilled into one month — tap it again to zoom out.' : 'Always the last 12 months. Tap a bar to drill in.'}
        </p>
        <div className="mt-2 h-56 text-muted-foreground">
          {trend.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'currentColor' }} interval="preserveStartEnd" />
                <YAxis tickFormatter={formatAxisMoney} tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: 'currentColor' }} />
                <Tooltip formatter={(v) => formatMoney(v)} cursor={{ fill: 'rgba(127,127,127,0.08)' }} contentStyle={tooltipStyle} />
                <Bar
                  dataKey="total"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={48}
                  onClick={(d) => pickMonth(d?.payload?.key ?? d?.key)}
                  className="cursor-pointer"
                >
                  {trend.map((m) => (
                    <Cell key={m.key} fill="#6366f1" fillOpacity={activeMonth && activeMonth !== m.key ? 0.3 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty>Nothing recorded in the last 12 months</Empty>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
