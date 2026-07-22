'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Award, CalendarCheck, CalendarDays, Clock, HandCoins, ListTodo, TriangleAlert, UserRound,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/glass/page-header';
import { GlassCard } from '@/components/glass/glass-card';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { Button } from '@/components/ui/button';
import { DateRange } from '@/components/ui/date-range';
import { formatMoney } from '@/lib/expense';
import { formatDuration } from '@/lib/time';
import { formatYMD } from '@/lib/leave';
import { APP_LIVE_YMD } from '@/lib/app-live';

const PERIODS = [
  { value: 'daily', label: 'Today' },
  { value: 'weekly', label: 'This week' },
  { value: 'monthly', label: 'This month' },
  { value: 'yearly', label: 'This year' },
  { value: 'custom', label: 'Custom' },
];

/** One number, said plainly. */
function Stat({ icon: Icon, label, value, hint, tone = 'default' }) {
  return (
    <div className="rounded-xl bg-card/60 p-3.5 ring-1 ring-border/60">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-tight', tone === 'warn' && 'text-amber-600 dark:text-amber-300', tone === 'good' && 'text-success')}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 break-words text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function MyStandingPage() {
  const [type, setType] = React.useState('monthly');
  const [range, setRange] = React.useState({ from: '', to: '' });

  const qs = React.useMemo(() => {
    const p = new URLSearchParams({ type });
    if (type === 'custom') {
      if (range.from) p.set('from', range.from);
      if (range.to) p.set('to', range.to);
    }
    return p.toString();
  }, [type, range]);

  const ready = type !== 'custom' || (!!range.from && !!range.to);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-standing', qs],
    queryFn: () => api.get(`/my-standing?${qs}`),
    enabled: ready,
    placeholderData: (prev) => prev,
  });

  const shows = data?.shows ?? {};
  const inP = data?.inPeriod;
  const now = data?.standing;
  const att = inP?.attendance;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="You"
        title="Where I stand"
        icon={UserRound}
        description="Your own numbers — attendance, hours, leave, work and dues — for whatever stretch of time you pick."
      />

      <div className="space-y-2.5 rounded-2xl border border-border/60 bg-card/80 p-3 shadow-sm backdrop-blur-xl">
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setType(p.value)}
              aria-pressed={type === p.value}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors',
                type === p.value
                  ? 'bg-primary text-primary-foreground ring-primary'
                  : 'bg-background/40 text-muted-foreground ring-border hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {type === 'custom' ? <DateRange value={range} onChange={setRange} min={APP_LIVE_YMD} /> : null}
      </div>

      {!ready ? (
        <EmptyState icon={CalendarDays} title="Pick two dates" description="Choose a start and an end date to see your numbers for that stretch." />
      ) : isError && !data ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn’t load your numbers"
          description={error?.message || 'Something went wrong. Check your connection and try again.'}
          action={<Button variant="outline" onClick={() => refetch()}>Try again</Button>}
        />
      ) : isLoading && !data ? (
        <LoadingState label="Working out where you stand…" />
      ) : data.notYetHere ? (
        <EmptyState
          icon={CalendarDays}
          title="You weren’t here yet"
          description={`This period ended before you joined on ${formatYMD(data.joinedYMD)}. Pick a later one.`}
        />
      ) : (
        <>
          {/* ── Right now: figures that belong to no period ── */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2 px-1">
              <h2 className="font-semibold tracking-tight">Right now</h2>
              <span className="text-xs text-muted-foreground">these don’t change with the period above</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {shows.leave && now.leave ? (
                <Stat
                  icon={CalendarDays}
                  label="Leave left this year"
                  value={`${now.leave.remaining} of ${now.leave.total}`}
                  hint={`${now.leave.used} used · resets 1 April`}
                  tone={now.leave.remaining <= 2 ? 'warn' : 'default'}
                />
              ) : null}
              <Stat
                icon={HandCoins}
                label={now.duesAdvance > 0 ? 'Advance with the office' : 'You owe the office'}
                value={formatMoney(now.duesAdvance > 0 ? now.duesAdvance : now.duesPending)}
                hint={now.duesPending === 0 && now.duesAdvance === 0 ? 'All settled' : 'Pay the admin manager in cash'}
                tone={now.duesAdvance > 0 ? 'good' : now.duesPending > 0 ? 'warn' : 'default'}
              />
              <Stat
                icon={ListTodo}
                label="Open tasks"
                value={now.tasksOpen}
                hint={now.tasksOverdue ? `${now.tasksOverdue} past their due date` : 'Nothing overdue'}
                tone={now.tasksOverdue ? 'warn' : 'default'}
              />
              {shows.points ? (
                <Stat
                  icon={Award}
                  label="Points this month"
                  value={now.pointsThisMonth}
                  hint={now.rupeesPerPoint ? `worth about ${formatMoney(now.pointsThisMonth * now.rupeesPerPoint * 100)}` : 'resets each month'}
                />
              ) : null}
            </div>
          </section>

          {/* ── In the chosen period ── */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2 px-1">
              <h2 className="font-semibold tracking-tight">{data.period.label || 'This period'}</h2>
              <span className="text-xs text-muted-foreground">
                {formatYMD(data.period.from)} – {formatYMD(data.period.to)}
                {data.ongoing ? ` · counted up to ${formatYMD(data.asOfYMD)}` : ''}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {shows.attendance && att ? (
                <>
                  <Stat
                    icon={CalendarCheck}
                    label="Days present"
                    value={att.workingDays === 0 ? '—' : `${att.present} of ${att.workingDays}`}
                    hint={
                      att.workingDays === 0
                        ? 'No working days in this stretch'
                        : `${att.attendanceRate}%${att.late ? ` · ${att.late} late` : ''}${att.absent ? ` · ${att.absent} absent` : ''}`
                    }
                    tone={att.workingDays > 0 && att.attendanceRate < 80 ? 'warn' : 'default'}
                  />
                  <Stat
                    icon={Clock}
                    label="Hours worked"
                    value={att.workedHours}
                    hint={att.overtimeMinutes ? `${formatDuration(att.overtimeMinutes)} overtime` : 'No overtime'}
                  />
                </>
              ) : null}

              {shows.leave ? (
                <Stat
                  icon={CalendarDays}
                  label="Leave taken"
                  value={inP.leaveDays}
                  hint={inP.leaveDays ? `${inP.leaves.length} request${inP.leaves.length === 1 ? '' : 's'}` : 'None in this period'}
                />
              ) : null}

              <Stat icon={ListTodo} label="Tasks finished" value={inP.tasksDone} hint={inP.tasksDone ? 'closed in this period' : 'None closed yet'} />

              <Stat
                icon={HandCoins}
                label="Dues added"
                value={formatMoney(inP.duesAdded)}
                hint={inP.duesPaid ? `${formatMoney(inP.duesPaid)} paid` : 'Nothing paid in this period'}
              />

              {shows.points ? (
                <Stat
                  icon={Award}
                  label="Points earned"
                  value={inP.points > 0 ? `+${inP.points}` : inP.points}
                  hint="awarded during these days"
                  tone={inP.points > 0 ? 'good' : inP.points < 0 ? 'warn' : 'default'}
                />
              ) : null}
            </div>

            {!shows.attendance && !shows.leave ? (
              <GlassCard className="p-4">
                <p className="text-sm text-muted-foreground">
                  Attendance and leave aren’t tracked for your role, so those aren’t shown — the rest is all yours.
                </p>
              </GlassCard>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
