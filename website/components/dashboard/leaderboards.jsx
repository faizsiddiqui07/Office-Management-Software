'use client';

import * as React from 'react';
import { Clock, Trophy } from 'lucide-react';
import { GlassCard } from '@/components/glass/glass-card';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/time';

/** Podium tints for the top three; everyone below is quiet. */
const RANK = ['text-amber-500', 'text-slate-400', 'text-amber-700'];

function LeaderList({ rows, valueOf, empty }) {
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

/**
 * The two public leaderboards, shown to everyone. Overtime is this month; the task
 * board toggles between this month and all-time (both come down in one request, so the
 * toggle is instant). The task board only counts on-time, CEO-involved delegated work —
 * that filtering all happens on the server.
 */
export function Leaderboards({ data }) {
  const [scope, setScope] = React.useState('month'); // task board only
  if (!data) return null;
  const taskRows = scope === 'month' ? data.taskMonth : data.taskAll;

  return (
    <section className="space-y-3">
      <h2 className="px-1 text-sm font-semibold tracking-tight text-muted-foreground">Leaderboards</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <GlassCard className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Trophy className="size-4 text-primary" />
            <p className="text-sm font-medium">Task leaders</p>
            <div className="ml-auto inline-flex rounded-lg bg-muted/50 p-0.5 text-xs">
              {[
                ['month', 'This month'],
                ['all', 'All-time'],
              ].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setScope(k)}
                  aria-pressed={scope === k}
                  className={cn(
                    'rounded-md px-2 py-1 font-medium transition-colors',
                    scope === k ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <LeaderList
            rows={taskRows}
            valueOf={(r) => `${r.count} task${r.count === 1 ? '' : 's'}`}
            empty={scope === 'month' ? 'No on-time tasks yet this month' : 'No on-time tasks tracked yet'}
          />
          <p className="mt-3 border-t border-border/50 pt-2 text-xs text-muted-foreground">
            Delegated work finished on time, where a CEO &amp; President is involved.
          </p>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            <p className="text-sm font-medium">Overtime leaders</p>
            <span className="ml-auto text-xs text-muted-foreground">{data.monthLabel}</span>
          </div>
          <LeaderList rows={data.overtime} valueOf={(r) => formatDuration(r.overtimeMinutes)} empty="No overtime logged this month" />
        </GlassCard>
      </div>
    </section>
  );
}
