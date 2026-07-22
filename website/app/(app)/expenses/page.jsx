'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wallet, X } from 'lucide-react';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/glass/page-header';
import { EmptyState } from '@/components/glass/empty-state';
import { ExpenseSummary } from '@/components/expenses/expense-summary';
import { ExpenseFilterBar } from '@/components/expenses/expense-filter-bar';
import { ExpenseDialog } from '@/components/expenses/add-expense-dialog';
import { ExpenseTable } from '@/components/expenses/expense-table';
import { EXPENSE_PERIODS, PAYMENT_LABELS, anchorFor, categoryLabel, formatMoneyShort } from '@/lib/expense';

// Same as the dashboard: the charting library is heavy, so let the table and
// summary paint first and bring the charts in behind a matching placeholder.
const ExpenseCharts = dynamic(() => import('@/components/expenses/expense-charts').then((m) => m.ExpenseCharts), {
  ssr: false,
  loading: () => <div className="grid gap-4 lg:grid-cols-2"><div className="h-72 animate-pulse rounded-2xl bg-foreground/[0.04]" /><div className="h-72 animate-pulse rounded-2xl bg-foreground/[0.04]" /></div>,
});

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const DEFAULT_FILTERS = {
  preset: 'this_month',
  monthKey: '', // set when you tap a bar in the trend chart
  from: '',
  to: '', // only for preset 'custom'
  category: 'ALL',
  payment: 'ALL',
  search: '',
};

/**
 * The query string for both the summary and the export. Built once, from one filter
 * object, with URLSearchParams — the old code interpolated `?from=${from}` by hand in
 * some places and used URLSearchParams in others, so a vendor search containing "&"
 * quietly gave the totals and the table two different filters.
 *
 * Note the client never computes a date range: it names a period and lets the server
 * resolve it. That keeps the fiscal year identical to the reports module and stops a
 * device in the wrong timezone from shifting it.
 */
function buildParams(f, search) {
  const p = new URLSearchParams();
  if (f.preset === 'custom') {
    p.set('period', 'custom');
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
  } else if (f.preset === 'month' && f.monthKey) {
    p.set('period', 'monthly');
    p.set('date', `${f.monthKey}-01`);
  } else {
    p.set('period', EXPENSE_PERIODS.find((x) => x.value === f.preset)?.period || 'yearly');
    p.set('date', anchorFor(f.preset));
  }
  if (f.category !== 'ALL') p.set('category', f.category);
  if (f.payment !== 'ALL') p.set('paymentMethod', f.payment);
  if (search) p.set('search', search);
  return p;
}

/** A removable filter — so a chart drill-in can be undone with one tap. */
function Chip({ children, onClear }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary ring-1 ring-primary/20">
      {children}
      <button type="button" onClick={onClear} aria-label="Remove this filter" className="rounded-full p-0.5 hover:bg-primary/15">
        <X className="size-3" />
      </button>
    </span>
  );
}

/**
 * What you are looking at, in words. The page can show a filtered table under an
 * unfiltered total only if nobody ever says out loud which slice is on screen.
 */
function ScopeLine({ filters, onChange, summary, loading }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const count = summary?.count ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1 text-sm text-muted-foreground">
      <span>
        {loading ? 'Loading…' : (
          <>
            <span className="font-medium text-foreground">{count}</span> {count === 1 ? 'expense' : 'expenses'}
            {' · '}
            <span className="font-medium text-foreground">{formatMoneyShort(summary?.total ?? 0)}</span>
            {summary?.period?.label ? <> in <span className="text-foreground">{summary.period.label}</span></> : null}
          </>
        )}
      </span>
      {filters.category !== 'ALL' ? <Chip onClear={() => set({ category: 'ALL' })}>{categoryLabel(filters.category)}</Chip> : null}
      {filters.payment !== 'ALL' ? <Chip onClear={() => set({ payment: 'ALL' })}>{PAYMENT_LABELS[filters.payment] ?? filters.payment}</Chip> : null}
      {filters.search ? <Chip onClear={() => set({ search: '' })}>“{filters.search}”</Chip> : null}
      {filters.preset === 'month' && filters.monthKey ? (
        <Chip onClear={() => set({ preset: 'this_fy', monthKey: '' })}>drilled into a month</Chip>
      ) : null}
    </div>
  );
}

export default function ExpensesPage() {
  const { user } = useAuth();
  const canView = !!user && can(user, 'viewExpenses');
  const canManage = !!user && can(user, 'manageExpenses');

  const [filters, setFilters] = React.useState(DEFAULT_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search.trim()), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  const params = buildParams(filters, debouncedSearch);
  const qs = params.toString();

  const { data: meta } = useQuery({ queryKey: ['expenses', 'meta'], queryFn: () => api.get('/expenses/meta'), enabled: canView });

  // ONE request for everything above the table. The key keeps the ['expenses', …]
  // prefix so the invalidate after an add/edit/delete still refreshes it.
  const { data: summary, isLoading, isPlaceholderData } = useQuery({
    queryKey: ['expenses', 'summary', qs],
    queryFn: () => api.get(`/expenses/summary?${qs}`),
    enabled: canView,
    placeholderData: (prev) => prev, // don't blank the headline on every filter tap
  });

  // The table reuses the range the SERVER resolved, so the rows and the totals above
  // them are the same slice by construction rather than by both doing the same maths.
  const range = summary?.period ? { from: summary.period.from, to: summary.period.to } : null;

  const exportCsv = async () => {
    if (!range) return;
    const p = new URLSearchParams({ from: range.from, to: range.to });
    if (filters.category !== 'ALL') p.set('category', filters.category);
    if (filters.payment !== 'ALL') p.set('paymentMethod', filters.payment);
    if (debouncedSearch) p.set('search', debouncedSearch);
    setExporting(true);
    try {
      await downloadFile(`${API_BASE}/api/expenses/export.csv?${p.toString()}`, `expenses-${range.from}-to-${range.to}.csv`);
    } catch (e) {
      toast.error(e?.message || 'Could not export');
    } finally {
      setExporting(false);
    }
  };

  if (!canView) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Finance" title="Expenses" icon={Wallet} />
        <EmptyState icon={Wallet} title="No access" description="You don’t have access to the expense register." />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Finance" title="Expenses" icon={Wallet} />

      <ExpenseFilterBar
        filters={{ ...filters, resolvedFrom: range?.from, resolvedTo: range?.to }}
        onChange={setFilters}
        categories={meta?.categories ?? []}
        onExport={exportCsv}
        exporting={exporting}
        canManage={canManage}
        addButton={<ExpenseDialog />}
      />

      <ScopeLine filters={filters} onChange={setFilters} summary={summary} loading={isLoading && !summary} />

      <ExpenseSummary summary={summary} loading={isLoading && !summary} stale={isPlaceholderData} />
      <ExpenseCharts summary={summary} filters={filters} onChange={setFilters} categories={meta?.categories ?? []} />
      <ExpenseTable canManage={canManage} filters={filters} search={debouncedSearch} range={range} />
    </div>
  );
}
