'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCheck,
  CheckCircle2,
  Download,
  HandCoins,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatMoney } from '@/lib/expense';
import { cn } from '@/lib/utils';
import { roleName } from '@/lib/permissions';
import { PageHeader } from '@/components/glass/page-header';
import { GlassCard } from '@/components/glass/glass-card';
import { StatCard } from '@/components/glass/stat-card';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import { DuesEntryDialog } from './dues-entry-dialog';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function initials(name = '') {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function BalanceChip({ p }) {
  if (p.pending > 0)
    return <span className="shrink-0 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-amber-600 ring-1 ring-warning/25 dark:text-amber-300">Owes {formatMoney(p.pending)}</span>;
  if (p.advance > 0)
    return <span className="shrink-0 rounded-full bg-success/12 px-2.5 py-1 text-xs font-semibold text-success ring-1 ring-success/20">Advance {formatMoney(p.advance)}</span>;
  return <span className="shrink-0 rounded-full bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border">Settled</span>;
}

function PersonDetail({ personId, onAddDue, onAddPay }) {
  const qc = useQueryClient();
  const [confirmSettle, setConfirmSettle] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['dues', 'person', personId],
    queryFn: () => api.get(`/dues/person/${personId}`),
    enabled: !!personId,
  });

  const settle = useMutation({
    mutationFn: () => api.post('/dues/settle', { person: personId }),
    onSuccess: (r) => {
      toast.success(r?.settled ? 'Settled in full' : 'Nothing pending');
      qc.invalidateQueries({ queryKey: ['dues'] });
      setConfirmSettle(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not settle'),
  });
  const del = useMutation({
    mutationFn: (id) => api.delete(`/dues/${id}`),
    onSuccess: () => {
      toast.success('Entry removed');
      qc.invalidateQueries({ queryKey: ['dues'] });
      setPendingDelete(null);
    },
    onError: (e) => toast.error(e?.message || 'Could not remove'),
  });
  const settleEntry = useMutation({
    mutationFn: (entryId) => api.post('/dues/settle-entry', { entryId }),
    onSuccess: () => {
      toast.success('Item settled');
      qc.invalidateQueries({ queryKey: ['dues'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not settle'),
  });

  if (!personId)
    return (
      <GlassCard className="flex min-h-[320px] items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">Select a person to see their ledger and add a due or payment.</p>
      </GlassCard>
    );
  if (isLoading || !data) return <GlassCard className="min-h-[320px] p-6"><LoadingState label="Loading ledger…" /></GlassCard>;

  const { person, pending, advance, entries } = data;

  return (
    <GlassCard className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{initials(person.name)}</span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{person.name}</p>
            <p className="truncate text-xs text-muted-foreground">{roleName(person)} · {person.employeeId}</p>
          </div>
        </div>
        <div className="text-right">
          {pending > 0 ? (
            <p className="text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-300">Owes {formatMoney(pending)}</p>
          ) : advance > 0 ? (
            <p className="text-lg font-semibold tabular-nums text-success">Advance {formatMoney(advance)}</p>
          ) : (
            <p className="text-lg font-semibold text-muted-foreground">Settled</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onAddDue(person.id)}>
          <Plus className="size-4" /> Add due
        </Button>
        <Button size="sm" variant="outline" onClick={() => onAddPay(person.id)}>
          <ArrowUpRight className="size-4" /> Record payment
        </Button>
        {pending > 0 ? (
          <Button size="sm" variant="outline" onClick={() => setConfirmSettle(true)}>
            <CheckCheck className="size-4" /> Settle all
          </Button>
        ) : null}
      </div>

      <div className="mt-5 space-y-1">
        <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">History</p>
        {entries.length ? (
          <div className="divide-y divide-border/50">
            {entries.map((e) => {
              const isDue = e.kind === 'DUE';
              const paid = isDue && e.status === 'PAID';
              const partial = isDue && e.status === 'PARTIAL';
              return (
                <div key={e.id} className="group flex items-start gap-3 py-2.5">
                  <span
                    className={cn(
                      'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1',
                      !isDue || paid ? 'bg-success/12 text-success ring-success/20' : 'bg-warning/12 text-amber-600 ring-warning/25 dark:text-amber-300',
                    )}
                  >
                    {!isDue ? <ArrowUpRight className="size-4" /> : paid ? <CheckCircle2 className="size-4" /> : <ArrowDownLeft className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {isDue ? e.item || 'Item' : e.note || 'Payment / advance'}
                      {isDue && e.source ? <span className="font-normal text-muted-foreground"> · {e.source}</span> : null}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs text-muted-foreground">{fmtDate(e.date)}</span>
                      {isDue ? (
                        paid ? (
                          <span className="text-xs font-medium text-success">Paid</span>
                        ) : partial ? (
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-300">Partial · {formatMoney(e.remaining)} left</span>
                        ) : (
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-300">Pending</span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">Advance / credit</span>
                      )}
                      {isDue && e.remaining > 0 ? (
                        <button
                          type="button"
                          onClick={() => settleEntry.mutate(e.id)}
                          disabled={settleEntry.isPending}
                          className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                        >
                          Settle {formatMoney(e.remaining)}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <span className={cn('text-sm font-semibold tabular-nums', !isDue ? 'text-success' : paid ? 'text-muted-foreground line-through' : 'text-amber-600 dark:text-amber-300')}>
                      {isDue ? '−' : '+'}
                      {formatMoney(e.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(e)}
                      aria-label="Remove entry"
                      className="rounded-md p-1.5 text-muted-foreground opacity-100 transition-opacity hover:text-destructive focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No entries yet for {person.name}.</p>
        )}
      </div>

      <ConfirmDialog
        open={confirmSettle}
        onOpenChange={setConfirmSettle}
        title={`Settle ${formatMoney(pending)}?`}
        description={`This records a full payment from ${person.name} and clears their pending balance.`}
        confirmLabel="Settle"
        loading={settle.isPending}
        onConfirm={() => settle.mutate()}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        tone="destructive"
        title="Remove this entry?"
        description={
          pendingDelete
            ? `${pendingDelete.kind === 'DUE' ? pendingDelete.item || 'Item' : 'Payment'} · ${formatMoney(pendingDelete.amount)} · ${fmtDate(pendingDelete.date)}. This changes ${person.name}'s balance and can't be undone.`
            : ''
        }
        confirmLabel="Remove"
        loading={del.isPending}
        onConfirm={() => pendingDelete && del.mutate(pendingDelete.id)}
      />
    </GlassCard>
  );
}

export function DuesAdmin() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['dues', 'overview'], queryFn: () => api.get('/dues/overview') });
  const [q, setQ] = React.useState('');
  const [selectedId, setSelectedId] = React.useState(null);
  const [dueOpen, setDueOpen] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);
  const [duePreset, setDuePreset] = React.useState(null);
  const [payPreset, setPayPreset] = React.useState(null);
  const detailRef = React.useRef(null);

  // Everyone except the admin themselves — you can't owe yourself.
  const people = (data?.people ?? []).filter((p) => p.person.id !== user?.id);
  const filtered = people.filter((p) => p.person.name.toLowerCase().includes(q.trim().toLowerCase()));

  const openDue = (personId = null) => {
    setDuePreset(personId);
    setDueOpen(true);
  };
  const openPay = (personId = null) => {
    setPayPreset(personId);
    setPayOpen(true);
  };
  const selectPerson = (id) => {
    setSelectedId(id);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  const exportCsv = async () => {
    try {
      await downloadFile(`${API_BASE}/api/dues/export.csv`, 'dues.csv');
    } catch (e) {
      toast.error(e?.message || 'Could not export');
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Dues"
        title="Dues ledger"
        icon={HandCoins}
        description="Track what each person owes you for lunch & errands — and their advances. Only you can see this."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportCsv}>
              <Download className="size-4" /> Export
            </Button>
            <Button variant="outline" onClick={() => openPay()}>
              <ArrowUpRight className="size-4" /> Payment
            </Button>
            <Button onClick={() => openDue()}>
              <Plus className="size-4" /> Add due
            </Button>
          </div>
        }
      />

      {isLoading || !data ? (
        <LoadingState label="Loading dues…" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Total pending" value={formatMoney(data.totalPending)} icon={ArrowDownLeft} tone={data.totalPending ? 'warning' : 'default'} hint={`${data.owingCount} owing`} />
            <StatCard label="Total advance" value={formatMoney(data.totalAdvance)} icon={ArrowUpRight} tone="success" hint="paid ahead" />
            <StatCard label="People" value={people.length} icon={Users} tone="default" />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" className="bg-background/50 pl-9" />
              </div>
              {people.length === 0 ? (
                <EmptyState icon={Users} title="No people yet" description="Add team members in Users — they’ll show up here to track dues." />
              ) : (
                <GlassCard className="divide-y divide-border/50 p-1.5">
                  {filtered.length ? (
                    filtered.map((p) => (
                      <button
                        key={p.person.id}
                        type="button"
                        onClick={() => selectPerson(p.person.id)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-foreground/5',
                          selectedId === p.person.id && 'bg-primary/[0.06] ring-1 ring-primary/15',
                        )}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(p.person.name)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{p.person.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{roleName(p.person)}</p>
                        </div>
                        <BalanceChip p={p} />
                      </button>
                    ))
                  ) : (
                    <p className="p-6 text-center text-sm text-muted-foreground">No people match “{q}”.</p>
                  )}
                </GlassCard>
              )}
            </div>

            <div ref={detailRef} className="scroll-mt-24">
              <PersonDetail personId={selectedId} onAddDue={openDue} onAddPay={openPay} />
            </div>
          </div>
        </>
      )}

      <DuesEntryDialog mode="due" people={people} presetPerson={duePreset} open={dueOpen} onOpenChange={setDueOpen} />
      <DuesEntryDialog mode="payment" people={people} presetPerson={payPreset} open={payOpen} onOpenChange={setPayOpen} />
    </div>
  );
}
