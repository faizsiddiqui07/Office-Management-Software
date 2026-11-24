'use client';

import * as React from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  CalendarDays,
  Clock,
  Home,
  Inbox,
  ListTodo,
  Plane,
  TimerReset,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { firstName } from '@/lib/name';
import { formatMoney, categoryLabel } from '@/lib/expense';
import { formatDuration } from '@/lib/time';
import { requestTypeLabel } from '@/lib/leave';
import { Button } from '@/components/ui/button';
import { QuickAttendanceAction } from '@/components/attendance/quick-attendance-action';
import { PageHeader } from '@/components/glass/page-header';
import { GlassCard } from '@/components/glass/glass-card';
import { Leaderboards } from '@/components/dashboard/leaderboards';
import { GlassPanel } from '@/components/glass/glass-panel';
import { StatCard } from '@/components/glass/stat-card';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { plainText } from '@/lib/rich-text';
// Charts pull in the charting library, which is by far the heaviest thing on this
// page — and the dashboard is the first screen everyone lands on. Load them after
// the page is interactive instead, behind placeholders of the same height so
// nothing jumps when they arrive.
const ChartFallback = ({ h }) => (
  <div className="animate-pulse rounded-xl bg-foreground/[0.04]" style={{ height: h }} />
);
const AttendanceDonut = dynamic(() => import('@/components/dashboard/charts').then((m) => m.AttendanceDonut), {
  ssr: false,
  loading: () => <ChartFallback h={220} />,
});
const ExpenseTrendChart = dynamic(() => import('@/components/dashboard/charts').then((m) => m.ExpenseTrendChart), {
  ssr: false,
  loading: () => <ChartFallback h={240} />,
});

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function fmtDate(iso) {
  // Accept both YMD strings and full ISO datetimes without a timezone shift.
  const v = String(iso).length <= 10 ? `${iso}T00:00:00` : iso;
  return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function humanizeAction(a) {
  return a.replace(/\./g, ' · ').replace(/_/g, ' ');
}

function SectionTitle({ children, action }) {
  return (
    <div className="flex items-center justify-between px-1">
      <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

/** Derives the "today" status card content from the attendance payload. */
function todayStat(today) {
  const rec = today?.record;
  // A real check-in wins over the holiday flag (someone working an OT holiday
  // should see their status, not "enjoy your day off").
  if (rec?.checkInAt) {
    if (rec.checkOutAt)
      return { value: 'Checked out', tone: 'success', hint: `${formatDuration(rec.workedMinutes || 0)} worked` };
    return {
      value: 'Checked in',
      tone: rec.status === 'LATE' ? 'warning' : 'success',
      hint: rec.status === 'LATE' ? 'Marked late' : 'Have a great day',
    };
  }
  if (today?.isHoliday) return { value: 'Holiday', tone: 'info', hint: 'Enjoy your day off' };
  return { value: 'Not in', tone: 'warning', hint: 'You haven’t checked in' };
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard'),
    enabled: !!user,
  });

  /*
   * Apne PENDING TASK ki ginti — owner ne dashboard par "Pending leaves" ki jagah yahi
   * maanga (21 Nov 2026). Chhutti ki ginti kahin gayi nahi: isi page par neeche "My
   * pending leaves" ka poora section pehle se hai.
   *
   * queryKey JAAN-BOOJH KAR wahi hai jo To-Do page use karta hai (`['tasks','summary']`)
   * — isse dono screen ek hi jawab baantte hain aur dashboard par ek bhi extra request
   * nahi jaati. Dashboard sabse zyada khulne wala page hai; yahan ek fazool call bhi
   * mehngi padti hai (pehle ek bhaari read se 9.5s wala page-load ka hadsa ho chuka hai).
   */
  const { data: taskSum } = useQuery({
    queryKey: ['tasks', 'summary'],
    queryFn: () => api.get('/tasks/summary'),
    staleTime: 60 * 1000,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-8">
        <PageHeader title={`${greeting()}${user ? `, ${firstName(user.name)}` : ''}`} />
        {isError ? (
          <EmptyState
            icon={Activity}
            title="Couldn’t load your dashboard"
            description="Please check your connection and try again."
            action={<Button onClick={() => window.location.reload()}>Try again</Button>}
          />
        ) : (
          <LoadingState label="Building your dashboard…" />
        )}
      </div>
    );
  }

  const { today, balance, announcements, upcomingHolidays, myPendingLeaves, whosOut, team, expenses, analytics, leaderboards } = data;
  const ts = todayStat(today);
  const isApprover = can(user, 'approveLeave');
  const canAudit = can(user, 'viewAudit'); // Recent activity = the audit feed
  const canApplyLeave = can(user, 'applyLeave'); // leadership can't take leave → no "my leaves"
  const canMark = can(user, 'markAttendance'); // some roles hold applyLeave WITHOUT attendance

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${greeting()}, ${firstName(user?.name)}`}
        description={`Here’s your snapshot for ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}.`}
      />

      {/*
        SIRF CHECK-IN / CHECK-OUT. Owner ka faisla, 19 Nov 2026.

        Pehle yahan saat tak button lag jaate the — Apply leave, Approvals, Add expense,
        Announce, Reports, Settings. Wo saare wahi jagah hain jahan sidebar se do tap me
        pahuncha ja sakta hai, aur dashboard ka pehla hissa unse bhar jaata tha. Jo kaam
        SIRF yahin ho sakta hai wo ek hi hai: hazri lagana.

        QuickAttendanceAction khud tay karta hai ki "Check in" dikhe ya "Check out" — to
        yahan koi doosra button jodna nahi hai.

        Jo banda attendance lagata hi nahi (leadership ke kuch role), uske liye poori
        kataar gayab — khaali div bhi nahi, warna neeche ka faasla do guna lagta hai.
      */}
      {canMark ? <QuickAttendanceAction /> : null}

      {/* Personal stats — each card gated on the permission that makes it TRUE for this
          person. "Today"/"Overtime" need markAttendance (a role that can't check in was
          stuck with a permanent amber "Not in" warning it could never clear); the leave
          cards need applyLeave.

          Phone par DO-DO ki kataar — wahi jo upar "Team today" par hai (owner, 20 Nov
          2026). Tippani YAHAN hai, ternary ke khulne wale bracket ke BAAD nahi: wahan
          JSX tippani tippani nahi rehti, ek object literal padhi jaati hai aur build
          gir jaati hai. (Aur tippani ke ANDAR comment band karne wale do akshar mat
          likhna — wo use beech me hi khatam kar dete hain; ye bhi chala kar pakda.) */}
      {canMark || canApplyLeave ? (
      <div className={cn('grid grid-cols-2 gap-3 sm:gap-4', canMark && canApplyLeave ? 'xl:grid-cols-4' : '')}>
        {canMark ? <StatCard tightOnPhone label="Today" value={ts.value} icon={UserCheck} tone={ts.tone} hint={ts.hint} /> : null}
        {canApplyLeave ? (
          <StatCard
            tightOnPhone
            label="Leave balance"
            value={`${balance?.remaining ?? 0}/${balance?.totalQuota ?? 0}`}
            icon={Plane}
            tone="info"
            hint="days available"
          />
        ) : null}
        <StatCard
          tightOnPhone
          label="Pending tasks"
          value={taskSum?.mine?.pending ?? 0}
          icon={ListTodo}
          tone={taskSum?.mine?.pending ? 'warning' : 'default'}
          hint={taskSum?.mine?.pending ? 'still to finish' : 'all clear'}
        />
        {canMark ? (
          <StatCard
            tightOnPhone
            label="Overtime banked"
            value={formatDuration(balance?.overtimeMinutes || 0)}
            icon={TimerReset}
            tone="default"
            hint="this year"
          />
        ) : null}
      </div>
      ) : null}

      {/* Team snapshot — managers & above */}
      {team ? (
        <section className="space-y-3">
          <SectionTitle
            action={
              team.pendingApprovals ? (
                <Link href="/leaves" className="text-sm font-medium text-primary hover:underline">
                  {team.pendingApprovals} pending approval{team.pendingApprovals > 1 ? 's' : ''} →
                </Link>
              ) : null
            }
          >
            Team today
          </SectionTitle>
          {/* Phone par DO-DO ki kataar (owner, 20 Nov 2026). Pehle ek-ek karke aate the,
              to chaar tile me poora pehla screen bhar jaata tha aur neeche kuch dikhta
              hi nahi tha. `tightOnPhone` sirf phone par padding/icon/figure chhota
              karta hai — laptop par tile poore ke poore rehte hain. */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard
              tightOnPhone
              label="Present"
              value={`${team.present}/${team.total}`}
              icon={Users}
              tone="success"
              hint={[team.late ? `${team.late} late` : '', team.awaited ? `${team.awaited} not in yet` : ''].filter(Boolean).join(' · ') || 'incl. late check-ins'}
            />
            <StatCard tightOnPhone label="On leave" value={team.onLeave} icon={Plane} tone="info" />
            <StatCard tightOnPhone label="Absent" value={team.absent} icon={CalendarDays} tone={team.absent ? 'destructive' : 'default'} />
            <StatCard tightOnPhone label="Team overtime" value={formatDuration(team.overtimeMinutes || 0)} icon={TimerReset} tone="default" hint="this month" />
          </div>
        </section>
      ) : null}

      {/* Expenses snapshot — month total + categories for every expense viewer. (The
          old `&& !analytics` gate made this DEAD CODE for the admin manager, who also
          holds leadershipDashboard; the trend chart below complements, not repeats, it.) */}
      {expenses ? (
        <section className="space-y-3">
          <SectionTitle action={<Link href="/expenses" className="text-sm font-medium text-primary hover:underline">Manage →</Link>}>
            Expenses this month
          </SectionTitle>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <StatCard label="Total spend" value={formatMoney(expenses.monthTotal)} icon={Wallet} tone="default" hint={`${expenses.count} entries`} />
            <GlassCard className="p-5 lg:col-span-2">
              <p className="mb-3 text-sm font-medium text-muted-foreground">Top categories</p>
              {expenses.byCategory.length ? (
                <ul className="space-y-2.5">
                  {expenses.byCategory.map((c) => (
                    <li key={c.category} className="flex items-center justify-between text-sm">
                      <span>{categoryLabel(c.category)}</span>
                      <span className="font-medium tabular-nums">{formatMoney(c.total)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No expenses recorded yet this month.</p>
              )}
            </GlassCard>
          </div>
        </section>
      ) : null}

      {/* Who's out — everyone, so "is X in today?" needs no page hop. Two plain rows:
          who's away TODAY, and who's away in the NEXT 7 DAYS. */}
      {whosOut ? (
        <section className="space-y-3">
          <SectionTitle>Who’s out</SectionTitle>
          <GlassCard className="space-y-4 p-5">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Today</p>
              {whosOut.officeWfh ? (
                <p className="inline-flex items-center gap-2 text-sm">
                  <Home className="size-4 text-primary" />
                  <span className="font-medium">Whole office is working from home.</span>
                </p>
              ) : whosOut.onLeave.length || whosOut.wfh.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {whosOut.onLeave.map((p, i) => (
                    <span key={`l-${i}`} className="inline-flex items-center gap-1.5 rounded-full bg-warning/12 px-2.5 py-1 text-xs font-medium text-amber-600 ring-1 ring-warning/25 dark:text-amber-300">
                      {p.name} <span className="opacity-70">· {requestTypeLabel(p.type)}</span>
                    </span>
                  ))}
                  {whosOut.wfh.map((name, i) => (
                    <span key={`w-${i}`} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                      <Home className="size-3" /> {name} <span className="opacity-70">· WFH</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Everyone’s in.</p>
              )}
            </div>

            {whosOut.upcoming?.length ? (
              <div className="border-t border-border/50 pt-3">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Next 7 days</p>
                <ul className="space-y-1 text-sm">
                  {whosOut.upcoming.map((p, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground">— {requestTypeLabel(p.type)} from {fmtDate(p.startYMD)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </GlassCard>
        </section>
      ) : null}

      {/* Leaderboards — shown to everyone, no restriction */}
      <Leaderboards data={leaderboards} />

      {/* Leadership analytics */}
      {analytics ? (
        <section className="space-y-3">
          <SectionTitle>Company analytics</SectionTitle>

          {/* Phone par DO-DO ki kataar — wahi jo upar "Team today" aur apne wale tile par hai
              (owner, 24 Nov 2026). Pehle ye chaar card phone par ek-ek karke neeche jaate the,
              yaani sirf inhe dekhne me char screen scroll. `tightOnPhone` sirf phone par padding,
              icon aur ank chhota karta hai; laptop par tile poore ke poore rehte hain. */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard tightOnPhone label="Headcount" value={analytics.headcount} icon={Users} tone="default" hint="active employees" />
            <StatCard
              tightOnPhone
              label="Attendance rate"
              value={`${analytics.attendanceRate}%`}
              icon={TrendingUp}
              tone="success"
              hint={analytics.breakdown?.awaited ? `${analytics.breakdown.awaited} not in yet` : 'present today'}
            />
            <StatCard
              tightOnPhone
              label="Pending approvals"
              value={analytics.pendingApprovalsCount ?? analytics.pendingApprovals.length}
              icon={Inbox}
              tone={(analytics.pendingApprovalsCount ?? analytics.pendingApprovals.length) ? 'warning' : 'default'}
              hint="leave requests"
            />
            <StatCard
              tightOnPhone
              label="Open tasks"
              value={analytics.openTasks}
              icon={ListTodo}
              tone={analytics.openTasks ? 'warning' : 'default'}
              hint="delegated work pending"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <GlassCard className="p-5">
              <p className="mb-2 text-sm font-medium">Today’s attendance</p>
              <AttendanceDonut breakdown={analytics.breakdown} rate={analytics.attendanceRate} />
            </GlassCard>

            {/* Absent for anyone without expense access — the server omits it rather than
                sending an empty series, so there is no card to misread as "nothing spent". */}
            {analytics.dailyExpenseTrend ? (
              <GlassCard className="p-5 xl:col-span-2">
                <p className="mb-2 text-sm font-medium">Spend this month{analytics.expenseMonthLabel ? ` · ${analytics.expenseMonthLabel}` : ''}</p>
                <ExpenseTrendChart data={analytics.dailyExpenseTrend} />
              </GlassCard>
            ) : null}
          </div>

          {/* Overtime leaders now lives in the common Leaderboards section above, for
              everyone — so it's not repeated here. */}
          <div className={cn('grid grid-cols-1 gap-6', canAudit && 'md:grid-cols-2')}>
            <GlassCard className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium">Pending approvals</p>
                {/* A leadershipDashboard holder without approveLeave could see this list
                    but the link was a dead end — read-only for them. */}
                {isApprover ? (
                  <Link href="/leaves" className="text-xs font-medium text-primary hover:underline">Review →</Link>
                ) : null}
              </div>
              {analytics.pendingApprovals.length ? (
                <ul className="space-y-2.5">
                  {analytics.pendingApprovals.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{fmtDate(p.startYMD)} → {fmtDate(p.endYMD)} · {p.days}d</p>
                      </div>
                      <StatusBadge tone={STATUS_TONES[p.type] ?? 'neutral'} dot={false} className="shrink-0">
                        {requestTypeLabel(p.type)}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">All caught up — nothing to review.</p>
              )}
            </GlassCard>

            {canAudit ? (
            <GlassCard className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium">Recent activity</p>
                <Link href="/activity" className="text-xs font-medium text-primary hover:underline">All →</Link>
              </div>
              {analytics.recentActivity?.length ? (
                <ul className="space-y-3">
                  {analytics.recentActivity.slice(0, 6).map((a, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/70" />
                      <div className="min-w-0">
                        <p className="truncate">
                          <span className="font-medium">{a.actor}</span>{' '}
                          <span className="text-muted-foreground">{humanizeAction(a.action)}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{timeAgo(a.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">No recent activity.</p>
              )}
            </GlassCard>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Common footer — announcements, holidays, my leaves */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <SectionTitle action={<Link href="/announcements" className="text-sm font-medium text-primary hover:underline">View all →</Link>}>
            Announcements
          </SectionTitle>
          <GlassCard className="divide-y divide-border/50 p-2">
            {announcements.length ? (
              announcements.map((a) => (
                <div key={a.id} className="flex items-start gap-3 p-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium leading-snug">{a.title}</p>
                    {a.body ? <p className="line-clamp-2 text-sm text-muted-foreground">{plainText(a.body)}</p> : null}
                    <p className="text-xs text-muted-foreground">{fmtDate(a.createdAt)}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">No announcements right now.</p>
            )}
          </GlassCard>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <SectionTitle>Upcoming holidays</SectionTitle>
            <GlassCard className="divide-y divide-border/50 p-2">
              {upcomingHolidays.length ? (
                upcomingHolidays.map((h) => (
                  <div key={h.occurrenceId || h.id} className="flex items-center justify-between gap-3 p-3">
                    <span className="truncate text-sm font-medium">{h.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {h.startYMD === h.endYMD ? fmtDate(h.startYMD) : `${fmtDate(h.startYMD)}–${fmtDate(h.endYMD)}`}
                    </span>
                  </div>
                ))
              ) : (
                <p className="p-6 text-center text-sm text-muted-foreground">No holidays scheduled.</p>
              )}
            </GlassCard>
          </div>

          {/* Only for people who can actually take leave — leadership doesn't, so this
              never sits on their dashboard reading "No pending requests." */}
          {canApplyLeave ? (
          <div className="space-y-3">
            <SectionTitle>My pending leaves</SectionTitle>
            <GlassCard className="divide-y divide-border/50 p-2">
              {myPendingLeaves.length ? (
                myPendingLeaves.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{requestTypeLabel(l.type)}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(l.startYMD)} → {fmtDate(l.endYMD)} · {l.workingDays}d</p>
                    </div>
                    <StatusBadge tone={STATUS_TONES[l.status] ?? 'warning'} className="shrink-0">Pending</StatusBadge>
                  </div>
                ))
              ) : (
                <p className="p-6 text-center text-sm text-muted-foreground">No pending requests.</p>
              )}
            </GlassCard>
          </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
