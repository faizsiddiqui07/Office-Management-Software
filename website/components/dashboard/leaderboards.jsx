'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Trophy } from 'lucide-react';
import { GlassCard } from '@/components/glass/glass-card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/time';
import { monthOptions } from '@/lib/reward-periods';

// Podium tints for the top three; everyone below is quiet. Bronze needs a lighter
// tone on the dark card — amber-700 is dark enough to disappear into the glass.
const RANK = ['text-amber-500', 'text-slate-400', 'text-amber-700 dark:text-amber-500/80'];

function LeaderList({ rows, valueOf, empty, loading }) {
  if (loading) return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
  if (!rows?.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="space-y-1.5">
      {rows.map((r, i) => (
        <li key={`${r.name}-${i}`} className="flex items-center gap-3 rounded-xl px-1.5 py-1.5">
          <span className={cn('w-5 shrink-0 text-center text-sm font-bold tabular-nums', RANK[i] ?? 'text-muted-foreground')}>
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{valueOf(r)}</span>
        </li>
      ))}
    </ol>
  );
}

/** This month · each past month (Jul 2026 →) · All time. */
function usePeriodOptions() {
  return React.useMemo(() => {
    const months = monthOptions(); // newest-first, includes the current month
    const current = months[0]?.value;
    const past = months.filter((m) => m.value !== current);
    return [{ value: 'this', label: 'This month' }, ...past, { value: 'all', label: 'All time' }];
  }, []);
}

/** Fetches a period's leaders. Disabled for 'this' — that data already came with the page. */
function useLeaders(sel) {
  const enabled = !!sel && sel !== 'this';
  const qs = sel === 'all' ? 'scope=all' : `scope=month&month=${sel}`;
  return useQuery({
    queryKey: ['dashboard', 'leaders', sel],
    queryFn: () => api.get(`/dashboard/leaders?${qs}`),
    enabled,
    staleTime: 60 * 1000,
  });
}

function PeriodSelect({ value, onChange, options }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="ml-auto h-7 w-auto gap-1 bg-muted/50 px-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * The two public leaderboards, shown to everyone. Each card carries its own period
 * picker — This month, any past month, or All time — so you can look back independently
 * on each. "This month" is served from the dashboard payload already loaded; other
 * periods are fetched on demand. Task leaders count on-time, CEO-involved delegated work,
 * all filtered on the server (on-time judged from the completion / approval day).
 */
export function Leaderboards({ data }) {
  const options = usePeriodOptions();
  const [taskSel, setTaskSel] = React.useState('this');
  const [otSel, setOtSel] = React.useState('this');
  const taskQ = useLeaders(taskSel);
  const otQ = useLeaders(otSel);
  if (!data) return null;

  const taskRows = taskSel === 'this' ? data.taskMonth : (taskQ.data?.task ?? []);
  const otRows = otSel === 'this' ? data.overtime : (otQ.data?.overtime ?? []);

  return (
    <section className="space-y-3">
      <h2 className="px-1 text-sm font-semibold tracking-tight text-muted-foreground">Leaderboards</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <GlassCard className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Trophy className="size-4 text-primary" />
            <p className="text-sm font-medium">Task leaders</p>
            <PeriodSelect value={taskSel} onChange={setTaskSel} options={options} />
          </div>
          <LeaderList
            rows={taskRows}
            loading={taskSel !== 'this' && taskQ.isLoading}
            valueOf={(r) => `${r.count} task${r.count === 1 ? '' : 's'}`}
            empty="No on-time tasks in this period"
          />
          <p className="mt-3 border-t border-border/50 pt-2 text-xs text-muted-foreground">
            Delegated work finished on time, where a CEO &amp; President is involved.
          </p>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            <p className="text-sm font-medium">Overtime leaders</p>
            <PeriodSelect value={otSel} onChange={setOtSel} options={options} />
          </div>
          <LeaderList
            rows={otRows}
            loading={otSel !== 'this' && otQ.isLoading}
            valueOf={(r) => formatDuration(r.overtimeMinutes)}
            empty="No overtime in this period"
          />
        </GlassCard>
      </div>
    </section>
  );
}
