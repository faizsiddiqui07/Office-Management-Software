'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  CalendarDays,
  CalendarPlus,
  Clock,
  FileText,
  Inbox,
  Megaphone,
  Plane,
  Settings,
  TimerReset,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, prettyRole } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { formatMoney, categoryLabel } from '@/lib/expense';
import { formatDuration } from '@/lib/time';
import { PageHeader } from '@/components/glass/page-header';
import { GlassCard } from '@/components/glass/glass-card';
import { GlassPanel } from '@/components/glass/glass-panel';
import { StatCard } from '@/components/glass/stat-card';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { AttendanceDonut, ExpenseTrendChart, OvertimeLeaders } from '@/components/dashboard/charts';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function firstName(name = '') {
  return name.split(' ')[0] || name;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
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

function QuickAction({ href, icon: Icon, children, primary }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium ring-1 transition-colors',
        primary
          ? 'bg-primary text-primary-foreground ring-primary/30 hover:bg-primary/90'
          : 'glass ring-border hover:bg-muted/40',
      )}
    >
      <Icon className="size-4" />
      {children}
    </Link>
  );
}

/** Derives the "today" status card content from the attendance payload. */
function todayStat(today) {
  const rec = today?.record;
  if (today?.isHoliday) return { value: 'Holiday', tone: 'info', hint: 'Enjoy your day off' };
  if (!rec || !rec.checkInAt) return { value: 'Not in', tone: 'warning', hint: 'You haven’t checked in' };
  if (rec.checkOutAt)
    return { value: 'Checked out', tone: 'success', hint: `${formatDuration(rec.workedMinutes || 0)} worked` };
  return {
    value: 'Checked in',
    tone: rec.status === 'LATE' ? 'warning' : 'success',
    hint: rec.status === 'LATE' ? 'Marked late' : 'Have a great day',
  };
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard'),
    enabled: !!user,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Overview" title={`${greeting()}${user ? `, ${firstName(user.name)}` : ''}`} />
        {isError ? (
          <EmptyState icon={Activity} title="Couldn’t load your dashboard" description="Please refresh in a moment." />
        ) : (
          <LoadingState label="Building your dashboard…" />
        )}
      </div>
    );
  }

  const { today, balance, announcements, upcomingHolidays, myPendingLeaves, team, expenses, analytics } = data;
  const ts = todayStat(today);
  const isApprover = can(user, 'approveLeave');
  const canAudit = can(user, 'viewAudit'); // Recent activity = the audit feed

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={prettyRole(data.role) || 'Overview'}
        title={`${greeting()}, ${firstName(user?.name)}`}
        description={`Here’s your snapshot for ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}.`}
      />

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2.5">
        <QuickAction href="/attendance" icon={Clock} primary>
          {today?.record?.checkInAt && !today?.record?.checkOutAt ? 'Check out' : 'Check in'}
        </QuickAction>
        <QuickAction href="/leaves" icon={CalendarPlus}>Apply leave</QuickAction>
        {isApprover ? (
          <QuickAction href="/leaves" icon={UserCheck}>Approvals</QuickAction>
        ) : null}
        {can(user, 'manageExpenses') ? (
          <QuickAction href="/expenses" icon={Wallet}>Add expense</QuickAction>
        ) : null}
        {can(user, 'postAnnouncements') ? (
          <QuickAction href="/announcements" icon={Megaphone}>Announce</QuickAction>
        ) : null}
        {can(user, 'downloadReports') ? (
          <QuickAction href="/reports" icon={FileText}>Reports</QuickAction>
        ) : null}
        {can(user, 'manageSettings') ? (
          <QuickAction href="/settings" icon={Settings}>Settings</QuickAction>
        ) : null}
      </div>

      {/* Personal stats — everyone */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today" value={ts.value} icon={UserCheck} tone={ts.tone} hint={ts.hint} />
        <StatCard
          label="Leave balance"
          value={`${balance.remaining}/${balance.totalQuota}`}
          icon={Plane}
          tone="info"
          hint="days available"
        />
        <StatCard
          label="Pending leaves"
          value={myPendingLeaves.length}
          icon={Inbox}
          tone={myPendingLeaves.length ? 'warning' : 'default'}
          hint="awaiting approval"
        />
        <StatCard
          label="Overtime banked"
          value={formatDuration(balance.overtimeMinutes || 0)}
          icon={TimerReset}
          tone="default"
          hint="this year"
        />
      </div>

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Present" value={`${team.present}/${team.total}`} icon={Users} tone="success" hint="incl. late check-ins" />
            <StatCard label="On leave" value={team.onLeave} icon={Plane} tone="info" />
            <StatCard label="Absent" value={team.absent} icon={CalendarDays} tone={team.absent ? 'destructive' : 'default'} />
            <StatCard label="Team overtime" value={formatDuration(team.overtimeMinutes || 0)} icon={TimerReset} tone="default" hint="this month" />
          </div>
        </section>
      ) : null}

      {/* Expenses snapshot — admin manager (leadership sees the trend chart below) */}
      {expenses && !analytics ? (
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

      {/* Leadership analytics */}
      {analytics ? (
        <section className="space-y-3">
          <SectionTitle>Company analytics</SectionTitle>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Headcount" value={analytics.headcount} icon={Users} tone="default" hint="active employees" />
            <StatCard label="Attendance rate" value={`${analytics.attendanceRate}%`} icon={TrendingUp} tone="success" hint="present today" />
            <StatCard label="Pending approvals" value={analytics.pendingApprovals.length} icon={Inbox} tone={analytics.pendingApprovals.length ? 'warning' : 'default'} hint="leave requests" />
            <StatCard
              label="Leave utilization"
              value={`${analytics.leaveUtilization.total ? Math.round((analytics.leaveUtilization.used / analytics.leaveUtilization.total) * 100) : 0}%`}
              icon={CalendarDays}
              tone="info"
              hint={`${analytics.leaveUtilization.used}/${analytics.leaveUtilization.total} days used`}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <GlassCard className="p-5">
              <p className="mb-2 text-sm font-medium">Today’s attendance</p>
              <AttendanceDonut breakdown={analytics.breakdown} rate={analytics.attendanceRate} />
            </GlassCard>

            <GlassCard className="p-5 xl:col-span-2">
              <p className="mb-2 text-sm font-medium">Monthly spend ({new Date().getFullYear()})</p>
              <ExpenseTrendChart data={analytics.monthlyExpenseTrend} />
            </GlassCard>
          </div>

          <div className={cn('grid grid-cols-1 gap-6', canAudit ? 'xl:grid-cols-3' : 'md:grid-cols-2')}>
            <GlassCard className="p-5">
              <p className="mb-3 text-sm font-medium">Overtime leaders</p>
              <OvertimeLeaders leaders={analytics.overtimeLeaders} />
            </GlassCard>

            <GlassCard className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium">Pending approvals</p>
                <Link href="/leaves" className="text-xs font-medium text-primary hover:underline">Review →</Link>
              </div>
              {analytics.pendingApprovals.length ? (
                <ul className="space-y-2.5">
                  {analytics.pendingApprovals.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.startYMD} → {p.endYMD} · {p.days}d</p>
                      </div>
                      <StatusBadge tone={STATUS_TONES[p.type] ?? 'neutral'} dot={false} className="shrink-0">
                        {p.type}
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
                    {a.body ? <p className="line-clamp-2 text-sm text-muted-foreground">{a.body}</p> : null}
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
                  <div key={h.id} className="flex items-center justify-between gap-3 p-3">
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

          <div className="space-y-3">
            <SectionTitle>My pending leaves</SectionTitle>
            <GlassCard className="divide-y divide-border/50 p-2">
              {myPendingLeaves.length ? (
                myPendingLeaves.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{l.type}</p>
                      <p className="text-xs text-muted-foreground">{l.startYMD} → {l.endYMD} · {l.workingDays}d</p>
                    </div>
                    <StatusBadge tone={STATUS_TONES[l.status] ?? 'warning'} className="shrink-0">{l.status}</StatusBadge>
                  </div>
                ))
              ) : (
                <p className="p-6 text-center text-sm text-muted-foreground">No pending requests.</p>
              )}
            </GlassCard>
          </div>
        </div>
      </div>
    </div>
  );
}
