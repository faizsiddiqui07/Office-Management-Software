'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Award, Coins, Gift, Info, Sparkles, Trash2, TrendingDown, TrendingUp, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, roleName } from '@/lib/permissions';
import { useMyBonus, useBonusGuide, useBonusConfig, useBonusLeaderboard, useUserBonus, useRecentAwards } from '@/lib/bonus';
import { PageHeader } from '@/components/glass/page-header';
import { GlassPanel } from '@/components/glass/glass-panel';
import { StatCard } from '@/components/glass/stat-card';
import { EmptyState } from '@/components/glass/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatRupees } from '@/lib/expense';
import { monthOptions, fyOptions, paramsForSelection } from '@/lib/reward-periods';
import { formatYMD } from '@/lib/leave';

/**
 * Accepts an ISO instant OR a plain 'YYYY-MM-DD' (which is what earnedYMD is). A plain
 * date is read in UTC so it never slides to the day before for a viewer west of India.
 */
function fmtDate(v, opts = { day: '2-digit', month: 'short' }) {
  if (!v) return '';
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(String(v));
  return new Date(ymd ? `${v}T00:00:00Z` : v).toLocaleDateString('en-GB', ymd ? { ...opts, timeZone: 'UTC' } : opts);
}
// Full date for the breakdown: in a yearly view a single "27 Jul" is ambiguous — the
// year matters — so both formatters coexist, this one used for entry rows.
function fmtDateFull(v) {
  return fmtDate(v, { day: '2-digit', month: 'short', year: 'numeric' });
}
const money = (n) => formatRupees(n);
const Pts = ({ n }) => <span className={n < 0 ? 'font-medium text-destructive' : 'font-medium text-emerald-600 dark:text-emerald-300'}>{n > 0 ? `+${n}` : n}</span>;

// What each kind of automatic entry is, in plain words, for the detail view.
const SOURCE_LABEL = {
  auto_task: 'Assigned task',
  auto_forward: 'Forwarded a task',
  auto_streak: 'Punctual streak',
  auto_late: 'Late arrival',
  auto_ot: 'Overtime',
  auto_absent: 'Absent day',
  auto_noleave: 'No leave taken',
  auto_perfect: 'Perfect attendance',
  manual: 'Awarded by leadership',
};

/* ── Detail dialogs (Task 4: click any point to see where it came from) ────────── */

function useTaskDetail(id) {
  return useQuery({
    queryKey: ['task', id],
    queryFn: () => api.get(`/tasks/${id}`),
    enabled: !!id,
    select: (r) => r.task,
  });
}

function Fact({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between gap-3 py-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

/** The full story of a task behind a point entry. */
function TaskFacts({ task }) {
  const collabs = (task.collaborators || []).map((c) => c.name).filter(Boolean).join(', ');
  return (
    <div className="divide-y divide-border/50 rounded-xl bg-foreground/[0.03] px-3.5 ring-1 ring-border/50">
      <Fact label="Task" value={task.title} />
      <Fact label="Assigned by" value={task.assignedBy?.name || task.originalAssignedBy?.name} />
      <Fact label="Assigned on" value={fmtDateFull(task.createdAt)} />
      <Fact label="Due date" value={task.dueYMD ? fmtDateFull(task.dueYMD) : 'No deadline'} />
      {task.requiresApproval ? <Fact label="Submitted" value={fmtDateFull(task.submittedAt)} /> : null}
      <Fact label="Completed on" value={fmtDateFull(task.completedAt)} />
      <Fact label="Completed by" value={task.completedBy?.name} />
      {task.approvedBy?.name ? <Fact label="Approved by" value={task.approvedBy.name} /> : null}
      <Fact label="Status" value={task.status === 'DONE' ? 'Done' : 'Pending'} />
      {collabs ? <Fact label="Tagged" value={collabs} /> : null}
      {task.notes ? <Fact label="Notes" value={task.notes} /> : null}
    </div>
  );
}

/** One point entry, expanded: what it was, what it's worth, and — if it's a task — the task. */
function EntryDetailDialog({ entry, onOpenChange }) {
  const isTask = (entry?.source === 'auto_task' || entry?.source === 'auto_forward') && !!entry?.taskRef;
  const q = useTaskDetail(isTask ? entry.taskRef : null);
  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-2">{entry?.reason}</DialogTitle>
          {/* The date is when the POINTS were counted — for a task that's the day it was
              completed/approved, NOT when it was assigned (the facts below show those).
              Labelled so "Assigned task · 13 Jul" isn't misread as "assigned on 13 Jul". */}
          <DialogDescription>
            {SOURCE_LABEL[entry?.source] || 'Points'} · {(entry?.points ?? 0) < 0 ? 'counted' : 'earned'} {fmtDateFull(entry?.earnedYMD || entry?.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-xl bg-foreground/[0.03] px-3.5 py-3 ring-1 ring-border/50">
          <span className="text-sm text-muted-foreground">Points</span>
          <span className="text-base"><Pts n={entry?.points ?? 0} /></span>
        </div>

        {isTask ? (
          q.isLoading ? (
            <p className="py-2 text-center text-sm text-muted-foreground">Loading task…</p>
          ) : q.isError ? (
            <p className="py-2 text-center text-sm text-muted-foreground">Couldn’t load the task’s details.</p>
          ) : q.data ? (
            <TaskFacts task={q.data} />
          ) : null
        ) : (
          <p className="text-sm text-muted-foreground">
            {entry?.source === 'manual'
              ? 'Given by leadership.'
              : 'Earned automatically from your attendance and work records.'}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A single clickable point row — used in both "My points" and a person's drill-down. */
function EntryRow({ entry, isRange, onOpen, onDelete }) {
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onOpen(entry)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04]"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{entry.reason}</p>
          <p className="text-xs text-muted-foreground">
            {(isRange ? fmtDateFull : fmtDate)(entry.earnedYMD || entry.createdAt)}
            {entry.source === 'manual' ? ' · awarded' : ' · automatic'}
          </p>
        </div>
        <span className="shrink-0 tabular-nums text-sm"><Pts n={entry.points} /></span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
      </button>
      {onDelete ? (
        <Button variant="ghost" size="icon" className="size-8 shrink-0 text-destructive" onClick={() => onDelete(entry.id)} aria-label="Remove">
          <Trash2 className="size-4" />
        </Button>
      ) : null}
    </li>
  );
}

/** Leadership drill-down: one person's whole breakdown for the period. */
function PersonBreakdownDialog({ person, params, label, isRange, onOpenChange, onOpenEntry }) {
  const q = useUserBonus(person?.id, params);
  const data = q.data;
  return (
    <Dialog open={!!person} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{person?.name}</DialogTitle>
          <DialogDescription>{roleName(person || {})} · {label}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-xl bg-foreground/[0.03] px-3.5 py-3 ring-1 ring-border/50">
          <span className="text-sm text-muted-foreground">Points · {label}</span>
          <span className="text-base"><Pts n={data?.points ?? 0} /></span>
        </div>

        {q.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : data?.entries?.length ? (
          <ul className="max-h-[50vh] divide-y divide-border/50 overflow-y-auto">
            {data.entries.map((e) => (
              <EntryRow key={e.id} entry={e} isRange={isRange} onOpen={onOpenEntry} />
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">No points in {label}.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The price list — what each action is worth — behind a button. */
/**
 * What each thing was worth DURING the period being viewed — not what it is worth today.
 * Rule values are effective-dated, so an old month keeps the prices it was scored on;
 * printing them here is what lets anyone check a total instead of taking it on trust.
 * More than one block means the values changed part-way through the period.
 */
function RatesPanel({ rates, periodLabel }) {
  if (!rates?.length) return null;
  const changed = rates.length > 1;
  return (
    <GlassPanel className="p-2">
      <div className="px-3 py-2">
        <span className="text-sm font-semibold">Point values · {periodLabel}</span>
        <p className="text-xs text-muted-foreground">
          {changed
            ? 'The values changed during this period — each block shows the dates it applied to. Points already earned keep the value they were earned at.'
            : 'What each thing was worth in this period. Changing a value later never re-prices points already earned.'}
        </p>
      </div>
      <div className="space-y-3 px-3 pb-3">
        {rates.map((p) => (
          <div key={p.from} className="rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
            {changed ? (
              <p className="mb-2 text-xs font-medium text-muted-foreground">{formatYMD(p.from)} – {formatYMD(p.to)}</p>
            ) : null}
            <ul className="divide-y divide-border/40">
              {p.rules.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <span className="min-w-0 truncate">{r.label}</span>
                  <Pts n={r.points} />
                </li>
              ))}
            </ul>
            {p.graceDays ? (
              <p className="mt-2 text-xs text-muted-foreground">Task grace: {p.graceDays} day{p.graceDays > 1 ? 's' : ''} after the due date.</p>
            ) : null}
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

function HowPointsDialog({ open, onOpenChange, guide }) {
  const rows = [...(guide?.autoRules ?? []), ...(guide?.manualItems ?? [])];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How points work</DialogTitle>
          {guide?.rupeesPerPoint ? (
            <DialogDescription>Every point is worth {money(guide.rupeesPerPoint)}.</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-foreground/[0.03] ring-1 ring-border/50">
          {rows.length ? (
            rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="text-sm">{r.label}</span>
                <span className="shrink-0 tabular-nums text-sm"><Pts n={r.points} /></span>
              </div>
            ))
          ) : (
            <p className="px-3.5 py-4 text-sm text-muted-foreground">No point values set yet.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Leadership-only: give points to a teammate and see the leaderboard.
 *  `isOwner` (CEO & President) also gets an undo on recent awards. */
function LeadershipTools({ isOwner, onDelete, periodParams, periodLabel, onOpenPerson }) {
  const qc = useQueryClient();
  const { data: cfg } = useBonusConfig();
  const { data: usersData } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users') });
  // Follows the period picked at the top of the page, not always "this month".
  const board = useBonusLeaderboard(periodParams);
  const recent = useRecentAwards();

  const users = (usersData?.users ?? []).filter((u) => u.isActive);
  const items = cfg?.manualItems ?? [];

  const [userId, setUserId] = React.useState('');
  const [itemId, setItemId] = React.useState('custom');
  const [points, setPoints] = React.useState('');
  const [reason, setReason] = React.useState('');

  const awardMut = useMutation({
    mutationFn: () => {
      const body = { userId };
      if (itemId && itemId !== 'custom') body.itemId = itemId;
      else { body.points = Number(points); body.reason = reason; }
      return api.post('/bonus/award', body);
    },
    onSuccess: () => {
      toast.success('Points awarded');
      qc.invalidateQueries({ queryKey: ['bonus'] });
      setPoints(''); setReason(''); setItemId('custom');
    },
    onError: (e) => toast.error(e?.message || 'Could not award'),
  });

  const submit = () => {
    if (!userId) return toast.error('Pick a person');
    if ((!itemId || itemId === 'custom') && (!Number(points) || !reason.trim())) return toast.error('Enter points and a reason');
    awardMut.mutate();
  };

  return (
    <div className="space-y-6">
      <GlassPanel className="space-y-4 p-4 sm:p-5">
        <h2 className="flex items-center gap-2 font-semibold tracking-tight"><Gift className="size-4 text-primary" /> Give points</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>To</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="w-full bg-background/50"><SelectValue placeholder="Pick a person…" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger className="w-full bg-background/50"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom…</SelectItem>
                {items.map((m) => <SelectItem key={m.id} value={m.id}>{m.label} ({m.points > 0 ? `+${m.points}` : m.points})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {itemId === 'custom' ? (
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <div className="space-y-1.5">
              <Label>Points (+/−)</Label>
              <Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="e.g. 20 or -10" className="bg-background/50" />
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What is it for?" className="bg-background/50" />
            </div>
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button onClick={submit} disabled={awardMut.isPending}>{awardMut.isPending ? 'Awarding…' : 'Award points'}</Button>
        </div>
      </GlassPanel>

      <GlassPanel className="p-2">
        <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold"><TrendingUp className="size-4 text-primary" /> Leaderboard · {periodLabel}</div>
        {board.data?.length ? (
          <ul className="divide-y divide-border/50">
            {board.data.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onOpenPerson(r)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04]"
                >
                  <span className="w-5 shrink-0 text-center text-xs font-medium text-muted-foreground tabular-nums">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{roleName(r)}{cfg?.rupeesPerPoint ? ` · ${money(r.rupees)}` : ''}</p>
                  </div>
                  <span className="shrink-0 tabular-nums"><Pts n={r.points} /></span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No points in {periodLabel}.</p>
        )}
      </GlassPanel>

      <GlassPanel className="p-2">
        <div className="px-3 py-2 text-sm font-semibold">Recent awards given</div>
        {recent.data?.length ? (
          <ul className="divide-y divide-border/50">
            {recent.data.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm"><span className="font-medium">{a.user?.name || '—'}</span> · {a.reason}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(a.createdAt)}{a.awardedBy?.name ? ` · by ${a.awardedBy.name}` : ''}</p>
                </div>
                <span className="shrink-0 tabular-nums text-sm"><Pts n={a.points} /></span>
                {isOwner ? (
                  <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => onDelete(a.id)} aria-label="Delete award"><Trash2 className="size-4" /></Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No awards given yet.</p>
        )}
        {!isOwner ? <p className="px-3 pb-2 pt-1 text-center text-xs text-muted-foreground">Only CEO &amp; President can undo an award.</p> : null}
      </GlassPanel>
    </div>
  );
}

export default function RewardsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isLeader = !!user && can(user, 'manageSettings');
  const isOwner = user?.role === 'CEO_PRESIDENT'; // CEO & President — only they can delete points

  // Period selector — Monthly (Jul 2026, Aug 2026…) or Yearly (FY 2026–27, FY 2027–28…).
  // Monthly starts at go-live (Jul 2026); Yearly is the financial year (Apr–Mar), like
  // the leave module. Default: current month.
  const months = React.useMemo(() => monthOptions(), []);
  const years = React.useMemo(() => fyOptions(), []);
  const [mode, setMode] = React.useState('monthly');
  const [monthly, setMonthly] = React.useState(() => months[0]?.value || '');
  const [yearly, setYearly] = React.useState(() => years[0]?.value || '');
  const selection = mode === 'monthly' ? monthly : yearly;
  const { params: mineParams, label: periodLabel } = paramsForSelection(mode, selection);
  const isRange = mode === 'yearly';

  const { data: me } = useMyBonus(mineParams);
  const { data: guide } = useBonusGuide();

  // Dialog state (Tasks 3 & 4)
  const [guideOpen, setGuideOpen] = React.useState(false);
  const [person, setPerson] = React.useState(null); // leaderboard drill-down
  const [detailEntry, setDetailEntry] = React.useState(null); // a single point's detail

  const delMut = useMutation({
    mutationFn: (id) => api.delete(`/bonus/entry/${id}`),
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: ['bonus'] }); },
    onError: (e) => toast.error(e?.message || 'Could not remove'),
  });

  const enabled = guide?.enabled ?? me?.enabled;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bonus"
        title="Rewards"
        icon={Award}
        description="Earn points for good work — leadership sets what each is worth. Positives reset each month; a negative balance carries into the next month until you clear it."
        actions={
          enabled === false ? null : (
            /* Monthly + Yearly picker. Two selects side-by-side on desktop; on phones they
               stack, each full-width, because the parent .actions is flex-wrap. */
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="min-w-[7.5rem] bg-background/50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly (FY)</SelectItem>
                </SelectContent>
              </Select>
              {mode === 'monthly' ? (
                <Select value={monthly} onValueChange={setMonthly}>
                  <SelectTrigger className="min-w-[9.5rem] bg-background/50"><SelectValue placeholder="Pick a month" /></SelectTrigger>
                  <SelectContent>
                    {months.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={yearly} onValueChange={setYearly}>
                  <SelectTrigger className="min-w-[9.5rem] bg-background/50"><SelectValue placeholder="Pick a year" /></SelectTrigger>
                  <SelectContent>
                    {years.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          )
        }
      />

      {enabled === false ? (
        <EmptyState
          icon={Sparkles}
          title="Rewards aren’t switched on yet"
          description={isLeader ? 'Turn on the bonus system and set point values in Settings → Bonus & rewards.' : 'Leadership will switch this on soon.'}
        />
      ) : (
        <>
          {/* My points. When a deficit has been carried in from earlier months, show it
              split three ways — this month vs carried-over vs net — so the two are never
              confused. Otherwise the simple one/two-card layout. */}
          {(me?.carriedOver ?? 0) < 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatCard label="This month" value={me?.earned ?? 0} hint={periodLabel} icon={Award} tone="default" />
              <StatCard label="Carried over" value={me?.carriedOver ?? 0} hint="deficit from earlier months" icon={TrendingDown} tone="destructive" />
              <StatCard label="Net total" value={me?.points ?? 0} hint={periodLabel} icon={Award} tone={(me?.points ?? 0) < 0 ? 'destructive' : 'success'} />
              {me?.rupeesPerPoint ? <StatCard label="Worth" value={money(me?.rupees)} hint={`${money(me?.rupeesPerPoint)}/point`} icon={Coins} tone="default" /> : null}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
              <StatCard label="My points" value={me?.points ?? 0} hint={periodLabel} icon={Award} tone="success" />
              {me?.rupeesPerPoint ? <StatCard label="Worth" value={money(me?.rupees)} hint={`${money(me?.rupeesPerPoint)}/point`} icon={Coins} tone="default" /> : null}
            </div>
          )}

          {/* My breakdown — now the FIRST thing under the stats. Each row opens its detail;
              a task row shows the whole task. "How points work" moved into a button. */}
          <GlassPanel className="p-2">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-sm font-semibold">My points · {periodLabel}</span>
              <Button variant="outline" size="sm" onClick={() => setGuideOpen(true)}>
                <Info className="size-4" /> How points work
              </Button>
            </div>
            {me?.entries?.length ? (
              <ul className="divide-y divide-border/50">
                {me.entries.map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    isRange={isRange}
                    onOpen={setDetailEntry}
                    onDelete={isOwner ? (id) => delMut.mutate(id) : undefined}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No points in {periodLabel} — keep it up!</p>
            )}
          </GlassPanel>

          <RatesPanel rates={me?.rates} periodLabel={periodLabel} />

          {isLeader ? (
            <LeadershipTools
              isOwner={isOwner}
              onDelete={(id) => delMut.mutate(id)}
              periodParams={mineParams}
              periodLabel={periodLabel}
              onOpenPerson={setPerson}
            />
          ) : null}

          {!isLeader ? (
            <p className="text-center text-xs text-muted-foreground">
              Points reset at the start of each month. Tap any line to see where it came from. Questions? Ask your manager.
            </p>
          ) : null}
          {isLeader ? (
            <p className="text-center text-xs text-muted-foreground">
              Set point values and add reward items in <Link href="/settings" className="font-medium text-primary hover:underline">Settings → Bonus &amp; rewards</Link>.
            </p>
          ) : null}

          {/* Dialogs */}
          <HowPointsDialog open={guideOpen} onOpenChange={setGuideOpen} guide={guide} />
          <PersonBreakdownDialog
            person={person}
            params={mineParams}
            label={periodLabel}
            isRange={isRange}
            onOpenChange={(o) => { if (!o) setPerson(null); }}
            onOpenEntry={setDetailEntry}
          />
          <EntryDetailDialog entry={detailEntry} onOpenChange={(o) => { if (!o) setDetailEntry(null); }} />
        </>
      )}
    </div>
  );
}
