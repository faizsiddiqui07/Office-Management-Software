'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Award, Coins, Gift, Sparkles, Trash2, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, roleName } from '@/lib/permissions';
import { useMyBonus, useBonusGuide, useBonusConfig, useBonusLeaderboard, useRecentAwards } from '@/lib/bonus';
import { PageHeader } from '@/components/glass/page-header';
import { GlassPanel } from '@/components/glass/glass-panel';
import { StatCard } from '@/components/glass/stat-card';
import { EmptyState } from '@/components/glass/empty-state';
import { StatusBadge } from '@/components/glass/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const Pts = ({ n }) => <span className={n < 0 ? 'font-medium text-destructive' : 'font-medium text-emerald-600 dark:text-emerald-300'}>{n > 0 ? `+${n}` : n}</span>;

/** Leadership-only: give points to a teammate and see the leaderboard.
 *  `isOwner` (CEO & President) also gets an undo on recent awards. */
function LeadershipTools({ isOwner, onDelete }) {
  const qc = useQueryClient();
  const { data: cfg } = useBonusConfig();
  const { data: usersData } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users') });
  const board = useBonusLeaderboard();
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
              <SelectTrigger className="bg-background/50"><SelectValue placeholder="Pick a person…" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger className="bg-background/50"><SelectValue /></SelectTrigger>
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
        <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold"><TrendingUp className="size-4 text-primary" /> Leaderboard · this month</div>
        {board.data?.length ? (
          <ul className="divide-y divide-border/50">
            {board.data.map((r, i) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="w-5 shrink-0 text-center text-xs font-medium text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{roleName(r)}{cfg?.rupeesPerPoint ? ` · ${money(r.rupees)}` : ''}</p>
                </div>
                <span className="shrink-0 tabular-nums"><Pts n={r.points} /></span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No points awarded yet this month.</p>
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
  const { data: me } = useMyBonus();
  const { data: guide } = useBonusGuide();

  const delMut = useMutation({
    mutationFn: (id) => api.delete(`/bonus/entry/${id}`),
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: ['bonus'] }); },
    onError: (e) => toast.error(e?.message || 'Could not remove'),
  });

  const enabled = guide?.enabled ?? me?.enabled;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Bonus" title="Rewards" icon={Award} description="Earn points for good work — leadership sets what each is worth, and points reset each month." />

      {enabled === false ? (
        <EmptyState
          icon={Sparkles}
          title="Rewards aren’t switched on yet"
          description={isLeader ? 'Turn on the bonus system and set point values in Settings → Bonus & rewards.' : 'Leadership will switch this on soon.'}
        />
      ) : (
        <>
          {/* My points */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard label="My points" value={me?.points ?? 0} hint="this month" icon={Award} tone="success" />
            {me?.rupeesPerPoint ? <StatCard label="Worth" value={money(me?.rupees)} hint={`${money(me?.rupeesPerPoint)}/point`} icon={Coins} tone="default" /> : null}
          </div>

          {/* How it works — the price list */}
          <GlassPanel className="space-y-3 p-4 sm:p-5">
            <h2 className="font-semibold tracking-tight">How points work</h2>
            {guide?.rupeesPerPoint ? (
              <p className="text-sm text-muted-foreground">Every point is worth <span className="font-medium text-foreground">{money(guide.rupeesPerPoint)}</span>.</p>
            ) : null}
            <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-foreground/[0.03] ring-1 ring-border/50">
              {[...(guide?.autoRules ?? []), ...(guide?.manualItems ?? [])].length ? (
                [...(guide?.autoRules ?? []), ...(guide?.manualItems ?? [])].map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-sm">{r.label}</span>
                    <span className="shrink-0 tabular-nums text-sm"><Pts n={r.points} /></span>
                  </div>
                ))
              ) : (
                <p className="px-3.5 py-4 text-sm text-muted-foreground">No point values set yet.</p>
              )}
            </div>
          </GlassPanel>

          {/* My breakdown */}
          <GlassPanel className="p-2">
            <div className="px-3 py-2 text-sm font-semibold">My points this month</div>
            {me?.entries?.length ? (
              <ul className="divide-y divide-border/50">
                {me.entries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{e.reason}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(e.createdAt)}{e.source === 'manual' ? ' · awarded' : ' · automatic'}</p>
                    </div>
                    <span className="shrink-0 tabular-nums text-sm"><Pts n={e.points} /></span>
                    {isOwner ? (
                      <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => delMut.mutate(e.id)} aria-label="Remove"><Trash2 className="size-4" /></Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No points yet this month — keep it up!</p>
            )}
          </GlassPanel>

          {isLeader ? <LeadershipTools isOwner={isOwner} onDelete={(id) => delMut.mutate(id)} /> : null}

          {!isLeader ? (
            <p className="text-center text-xs text-muted-foreground">
              Points reset at the start of each month. Questions? Ask your manager.
            </p>
          ) : null}
          {isLeader ? (
            <p className="text-center text-xs text-muted-foreground">
              Set point values and add reward items in <Link href="/settings" className="font-medium text-primary hover:underline">Settings → Bonus &amp; rewards</Link>.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
