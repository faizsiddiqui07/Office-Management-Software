'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
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
  wfh: 'var(--chart-1)',
  awaited: '#94a3b8', // neutral — not judged yet
  offToday: '#64748b', // a part-timer's own off-day
};

const ATT_LABELS = { present: 'Present', late: 'Late', absent: 'Absent', onLeave: 'On leave', wfh: 'From home', awaited: 'Not in yet', offToday: 'Off today' };

function dayOfMonth(ymd) {
  return Number(ymd.slice(8, 10));
}

function dayLabel(ymd) {
  // Full date for the tooltip (e.g. "3 Jul"). UTC so a device west of India doesn't
  // slide it to the previous day.
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
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
  // A row may carry its own heading (e.g. the full date for a daily point whose axis
  // only shows the day number); fall back to the axis label otherwise.
  const heading = payload[0]?.payload?.tooltipLabel ?? label;
  return (
    <div className="rounded-lg border border-border/60 bg-background/90 px-3 py-2 text-xs shadow-lg backdrop-blur">
      {heading ? <p className="mb-1 font-medium">{heading}</p> : null}
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
  // WFH must be a slice of its own, or people working from home vanish from the donut
  // and its total stops matching the headcount. Same for "not in yet" (awaited) and a
  // part-timer's off-day — without them the morning donut showed 2 people as the whole
  // office while the centre said 20%.
  const data = ['present', 'late', 'absent', 'onLeave', 'wfh', 'awaited', 'offToday']
    .map((k) => ({ key: k, name: ATT_LABELS[k], value: breakdown[k] ?? 0 }))
    .filter((d) => d.key === 'present' || d.value > 0); // zero slices add legend noise only
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
  // This month's spend, one point per day. The axis shows the day number (1, 5, 10…) so
  // 31 of them stay readable; the tooltip carries the full date.
  const rows = (data ?? []).map((d) => ({
    day: dayOfMonth(d.ymd),
    tooltipLabel: dayLabel(d.ymd),
    total: d.total / 100,
  }));
  if (!rows.length) return <EmptyMini label="No expenses recorded yet" />;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={rows} margin={{ left: -8, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          minTickGap={16}
          tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickFormatter={(v) => `₹${compact(v)}`}
        />
        <Tooltip content={<GlassTooltip formatter={(v) => formatMoney(Math.round(v * 100))} />} />
        <Line type="monotone" dataKey="total" name="Spend" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
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
