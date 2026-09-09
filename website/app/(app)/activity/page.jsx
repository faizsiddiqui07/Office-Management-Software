'use client';

import * as React from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Activity, ChevronLeft, ChevronRight, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, prettyRole } from '@/lib/permissions';
import { DatePicker } from '@/components/ui/date-picker';
import { APP_LIVE_YMD } from '@/lib/app-live';
import { useRoleOptions } from '@/lib/use-roles';
import { PageHeader } from '@/components/glass/page-header';
import { GlassPanel } from '@/components/glass/glass-panel';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { QueryError } from '@/components/glass/query-error';
import { StatusBadge } from '@/components/glass/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';

const PAGE_SIZES = [25, 50, 75, 100];

function fmtWhen(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date}, ${time}`;
}

function humanize(a) {
  return a.replace(/\./g, ' · ').replace(/_/g, ' ');
}

// Anything whose NAME suggests a credential is never printed, whatever it holds. The
// log is read by leadership and some entries carry a whole request body.
const SECRET_KEY = /pass|token|secret|hash|key|otp/i;

/**
 * One short line saying what the entry was actually about.
 *
 * "task · update" on its own answers nothing — the question people bring here is which
 * task, and what changed about it. The known shapes are spelled out; anything else falls
 * back to its first couple of simple values, so a new action added later still says
 * something rather than showing a blank.
 */
function detailOf(l) {
  const m = l.meta || {};
  const bits = [];
  if (m.title) bits.push(m.title);
  if (Array.isArray(m.fields) && m.fields.length) bits.push(`changed ${m.fields.join(', ')}`);
  if (m.status) bits.push(String(m.status).toLowerCase().replace(/_/g, ' '));
  if (m.owner) bits.push(`for ${m.owner}`);
  if (m.cascaded) bits.push(`${m.cascaded} forwarded ${m.cascaded === 1 ? 'copy' : 'copies'} too`);
  if (m.reason) bits.push(`“${m.reason}”`);
  if (typeof m.to === 'string' && m.to) bits.push(`to ${m.to}`);
  if (m.email) bits.push(m.email);
  if (!bits.length) {
    for (const [k, v] of Object.entries(m)) {
      if (bits.length >= 2) break;
      if (v == null || typeof v === 'object' || SECRET_KEY.test(k)) continue;
      bits.push(`${k}: ${typeof v === 'boolean' ? (v ? 'yes' : 'no') : v}`);
    }
  }
  return bits.join(' · ');
}

export default function ActivityPage() {
  const { user } = useAuth();
  const allowed = !!user && can(user, 'viewAudit');
  // The audit feed stores role keys; warm the label cache so `prettyRole`
  // renders edited names next to each actor.
  useRoleOptions();

  const [action, setAction] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(PAGE_SIZES[0]);

  // Reset to first page whenever a filter (or the page size) changes.
  React.useEffect(() => setPage(1), [action, from, to, limit]);

  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (action.trim()) query.set('action', action.trim());
  if (from) query.set('from', from);
  if (to) query.set('to', to);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['audit', action, from, to, page, limit],
    queryFn: () => api.get(`/audit?${query.toString()}`),
    enabled: allowed,
    placeholderData: keepPreviousData,
  });

  if (!allowed) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Activity" title="Activity log" icon={Activity} />
        <EmptyState icon={ShieldAlert} title="No access" description="Only leadership (CEO / Boss) can view the activity log." />
      </div>
    );
  }

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Activity"
        title="Activity log"
        icon={Activity}
        description="Every meaningful action across the company, newest first."
      />

      <GlassPanel className="p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-full space-y-1.5 sm:w-auto">
            <Label htmlFor="a-action">Action starts with</Label>
            <Input id="a-action" value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. leave, auth.login" className="w-full bg-background/50 sm:w-52" />
          </div>
          <div className="w-full space-y-1.5 sm:w-auto">
            <Label htmlFor="a-from">From</Label>
            <DatePicker id="a-from" value={from} min={APP_LIVE_YMD} max={to || undefined} onChange={setFrom} className="w-full bg-background/50 sm:w-44" />
          </div>
          <div className="w-full space-y-1.5 sm:w-auto">
            <Label htmlFor="a-to">To</Label>
            <DatePicker id="a-to" value={to} min={from || APP_LIVE_YMD} onChange={setTo} className="w-full bg-background/50 sm:w-44" />
          </div>
          {(action || from || to) ? (
            <Button variant="ghost" onClick={() => { setAction(''); setFrom(''); setTo(''); }}>Clear</Button>
          ) : null}
          <span className="ml-auto self-center text-sm text-muted-foreground">{total} event{total === 1 ? '' : 's'}</span>
        </div>
      </GlassPanel>

      {isError && !data ? (
        <QueryError title="Couldn’t load the activity log" error={error} onRetry={refetch} />
      ) : isLoading ? (
        <LoadingState label="Loading activity…" />
      ) : logs.length === 0 ? (
        <EmptyState icon={Activity} title="No activity" description="No events match these filters." />
      ) : (
        <GlassPanel className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[640px] divide-y divide-border/50">
              <div className="grid grid-cols-[1fr_1.2fr_1.4fr_0.8fr] gap-3 px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span>When</span><span>Who</span><span>Action</span><span>Entity</span>
              </div>
              {logs.map((l) => (
                <div key={l.id} className="grid grid-cols-[1fr_1.2fr_1.4fr_0.8fr] items-start gap-3 px-5 py-3 text-sm">
                  <span className="tabular-nums text-muted-foreground">{fmtWhen(l.createdAt)}</span>
                  <span className="min-w-0">
                    <span className="truncate font-medium">{l.actor}</span>
                    {l.actorRole ? <span className="ml-1.5 text-xs text-muted-foreground">{prettyRole(l.actorRole)}</span> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{humanize(l.action)}</span>
                    {detailOf(l) ? (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={detailOf(l)}>
                        {detailOf(l)}
                      </span>
                    ) : null}
                  </span>
                  <span>{l.entityType ? <StatusBadge tone="neutral" dot={false}>{l.entityType}</StatusBadge> : <span className="text-muted-foreground">—</span>}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 px-5 py-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Rows</span>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger className="h-8 w-[4.5rem] bg-background/50">
                  <span className="tabular-nums">{limit}</span>
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="text-muted-foreground">Page {page} of {pages}{isFetching ? ' · updating…' : ''}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="size-4" /> Prev
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
