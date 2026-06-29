'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney } from '@/lib/expense';
import { formatDuration } from '@/lib/time';

const ATT_COLORS = {
  present: 'var(--chart-3)',
  late: 'var(--chart-4)',
  absent: 'var(--chart-5)',
  onLeave: 'var(--chart-2)',
};

const ATT_LABELS = { present: 'Present', late: 'Late', absent: 'Absent', onLeave: 'On leave' };

function monthShort(ym) {
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('en-US', { month: 'short' });
}

function compact(n) {
  if (n >= 1_00_000) return `${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function EmptyMini({ label }) {
  return (
    <div className="flex h-[200px] items-center justify-center rounded-xl border border-dashed border-border/60 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function GlassTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-background/90 px-3 py-2 text-xs shadow-lg backdrop-blur">
      {label ? <p className="mb-1 font-medium">{label}</p> : null}
      {payload.map((p, i) => (
        <p key={i} className="text-muted-foreground">
          {p.name}:{' '}
          <span className="font-medium text-foreground tabular-nums">
            {formatter ? formatter(p.value) : p.value}
          </span>
        </p>
      ))}
    </div>
  );
}

export function AttendanceDonut({ breakdown, rate }) {
  const data = ['present', 'late', 'absent', 'onLeave'].map((k) => ({
    key: k,
    name: ATT_LABELS[k],
    value: breakdown[k] ?? 0,
  }));
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="space-y-4">
      {total === 0 ? (
        <EmptyMini label="No attendance recorded yet today" />
      ) : (
        <div className="relative">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={64}
                outerRadius={94}
                paddingAngle={2}
                strokeWidth={0}
              >
                {data.map((d) => (
                  <Cell key={d.key} fill={ATT_COLORS[d.key]} />
                ))}
              </Pie>
              <Tooltip content={<GlassTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-semibold tabular-nums">{rate}%</span>
            <span className="text-xs text-muted-foreground">present</span>
          </div>
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {data.map((d) => (
          <span key={d.key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2.5 rounded-full" style={{ background: ATT_COLORS[d.key] }} />
            {d.name} <span className="font-medium text-foreground tabular-nums">{d.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ExpenseTrendChart({ data }) {
  const rows = (data ?? []).map((d) => ({ month: monthShort(d.month), total: d.total / 100 }));
  if (!rows.length) return <EmptyMini label="No expenses recorded yet" />;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={rows} margin={{ left: -8, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickFormatter={(v) => `₹${compact(v)}`}
        />
        <Tooltip content={<GlassTooltip formatter={(v) => formatMoney(Math.round(v * 100))} />} />
        <Area type="monotone" dataKey="total" name="Spend" stroke="var(--chart-1)" strokeWidth={2} fill="url(#expGrad)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function OvertimeLeaders({ leaders }) {
  if (!leaders?.length) return <EmptyMini label="No overtime logged this month" />;
  const rows = leaders.map((l) => ({ name: l.name.split(' ')[0], minutes: l.overtimeMinutes }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(150, rows.length * 46)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          tickLine={false}
          axisLine={false}
          width={80}
          tick={{ fontSize: 12, fill: 'var(--foreground)' }}
        />
        <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.25 }} content={<GlassTooltip formatter={(v) => formatDuration(v)} />} />
        <Bar dataKey="minutes" name="Overtime" radius={[0, 6, 6, 0]} fill="var(--chart-1)" barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}
