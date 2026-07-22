'use client';

import * as React from 'react';
import { Download, Search, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateRange } from '@/components/ui/date-range';
import { EXPENSE_PERIODS, PAYMENT_METHODS, categoryLabel, todayYMD } from '@/lib/expense';

/**
 * Every control that changes what the page is showing, in one place at the top.
 *
 * It owns nothing: the page holds the filter object and everything below reads the
 * same one. That is the actual fix — the summary and the charts used to fetch their
 * own fixed year while only the table listened to these controls, so the two halves
 * of the page routinely described different slices of the register.
 */
export function ExpenseFilterBar({ filters, onChange, categories = [], onExport, exporting = false, canManage, addButton }) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const set = (patch) => onChange({ ...filters, ...patch });

  const extras = (filters.category !== 'ALL' ? 1 : 0) + (filters.payment !== 'ALL' ? 1 : 0) + (filters.search ? 1 : 0);

  const pickPreset = (value) => {
    // Landing on Custom with no dates would fetch the whole register on one tap, so
    // it opens on the window you were already looking at.
    if (value === 'custom') set({ preset: 'custom', from: filters.resolvedFrom || '', to: filters.resolvedTo || '' });
    else set({ preset: value, monthKey: '' });
  };

  const controls = (
    <>
      <div className="relative w-full lg:max-w-[15rem]">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Search title or vendor…"
          className="h-9 bg-background/50 pl-9"
        />
      </div>
      <Select value={filters.category} onValueChange={(v) => set({ category: v })}>
        <SelectTrigger className="h-9 w-full bg-background/50 lg:w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All categories</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.payment} onValueChange={(v) => set({ payment: v })}>
        <SelectTrigger className="h-9 w-full bg-background/50 lg:w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All methods</SelectItem>
          {PAYMENT_METHODS.map((p) => (
            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  return (
    <div className="sticky top-[4.5rem] z-20 -mx-1 space-y-2 rounded-2xl bg-background/70 px-1 py-2 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-2">
        {/* Period first: it's the control everyone reaches for, and the only one
            leadership touches when they open this once a month. */}
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5">
          {EXPENSE_PERIODS.map((p) => {
            const on = filters.preset === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => pickPreset(p.value)}
                aria-pressed={on}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors',
                  on ? 'bg-primary/12 text-primary ring-primary/25' : 'bg-muted/40 text-muted-foreground ring-border hover:text-foreground',
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Everything else stays inline where there's room, and folds away where there isn't. */}
        <div className="hidden items-center gap-2 lg:flex">{controls}</div>

        <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setSheetOpen(true)}>
          <SlidersHorizontal className="size-4" />
          Filters
          {extras ? <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary">{extras}</span> : null}
        </Button>

        <Button variant="outline" size="sm" onClick={onExport} disabled={exporting} title="Download these rows as CSV">
          <Download className="size-4" />
          <span className="hidden sm:inline">{exporting ? 'Exporting…' : 'Export'}</span>
        </Button>

        {canManage && addButton ? <div className="ml-auto lg:ml-0">{addButton}</div> : null}
      </div>

      {filters.preset === 'custom' ? (
        <DateRange value={{ from: filters.from, to: filters.to }} onChange={(r) => set({ from: r.from, to: r.to })} max={todayYMD()} />
      ) : null}

      <AppDialog
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Filters"
        description="Narrow the register. The totals and charts above follow along."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => set({ category: 'ALL', payment: 'ALL', search: '' })}
              disabled={!extras}
            >
              <X className="size-4" /> Clear
            </Button>
            <Button onClick={() => setSheetOpen(false)}>Done</Button>
          </>
        }
      >
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="exp-search">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="exp-search"
                value={filters.search}
                onChange={(e) => set({ search: e.target.value })}
                placeholder="Title or vendor…"
                className="bg-background/50 pl-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={filters.category} onValueChange={(v) => set({ category: v })}>
              <SelectTrigger className="w-full bg-background/50"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Payment method</Label>
            <Select value={filters.payment} onValueChange={(v) => set({ payment: v })}>
              <SelectTrigger className="w-full bg-background/50"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All methods</SelectItem>
                {PAYMENT_METHODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </AppDialog>
    </div>
  );
}
