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
 * own fixed year while only the table listened to these controls.
 *
 * Two rows, not one. Period is the control everyone reaches for and it earns a line
 * of its own; cramming it in beside four other controls left the chips clipped behind
 * a scrollbar. The chips WRAP rather than scroll, so none of them can hide.
 */
export function ExpenseFilterBar({ filters, onChange, categories = [], onExport, exporting = false, canManage, addButton }) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const set = (patch) => onChange({ ...filters, ...patch });

  const extras = (filters.category !== 'ALL' ? 1 : 0) + (filters.payment !== 'ALL' ? 1 : 0) + (filters.search ? 1 : 0);

  const pickPreset = (value) => {
    // Landing on Custom with no dates would fetch the whole register on one tap, so
    // it opens on the window you were already looking at.
    if (value === 'custom') set({ preset: 'custom', monthKey: '', from: filters.resolvedFrom || '', to: filters.resolvedTo || '' });
    else set({ preset: value, monthKey: '' });
  };

  const searchBox = (id, placeholder) => (
    <div className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        value={filters.search}
        onChange={(e) => set({ search: e.target.value })}
        placeholder={placeholder}
        className="h-9 bg-background/50 pl-9"
      />
    </div>
  );

  const categorySelect = (
    <Select value={filters.category} onValueChange={(v) => set({ category: v })}>
      <SelectTrigger className="h-9 w-full bg-background/50"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">All categories</SelectItem>
        {categories.map((c) => (
          <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const methodSelect = (
    <Select value={filters.payment} onValueChange={(v) => set({ payment: v })}>
      <SelectTrigger className="h-9 w-full bg-background/50"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">All methods</SelectItem>
        {PAYMENT_METHODS.map((p) => (
          <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="sticky top-[4.25rem] z-20 space-y-2.5 rounded-2xl border border-border/60 bg-card/80 p-3 shadow-sm backdrop-blur-xl">
      {/* Row 1 — the period. Wraps to a second line on a narrow phone rather than
          hiding a chip off the edge. */}
      <div className="flex flex-wrap gap-1.5">
        {EXPENSE_PERIODS.map((p) => {
          const on = filters.preset === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => pickPreset(p.value)}
              aria-pressed={on}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors',
                on
                  ? 'bg-primary text-primary-foreground ring-primary'
                  : 'bg-background/40 text-muted-foreground ring-border hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Row 2 — narrowing, then the actions. On a phone the three narrowing controls
          fold into one button so this stays a single short row. */}
      <div className="flex items-center gap-2">
        <div className="hidden min-w-0 flex-1 items-center gap-2 lg:flex">
          <div className="min-w-0 max-w-xs flex-1">{searchBox('exp-search-lg', 'Search title or vendor…')}</div>
          <div className="w-44 shrink-0">{categorySelect}</div>
          <div className="w-40 shrink-0">{methodSelect}</div>
        </div>

        <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setSheetOpen(true)}>
          <SlidersHorizontal className="size-4" />
          Filters
          {extras ? (
            <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary">{extras}</span>
          ) : null}
        </Button>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExport} disabled={exporting} title="Download these rows as CSV">
            <Download className="size-4" />
            <span className="hidden sm:inline">{exporting ? 'Exporting…' : 'Export'}</span>
          </Button>
          {canManage && addButton ? addButton : null}
        </div>
      </div>

      {filters.preset === 'custom' ? (
        <DateRange value={{ from: filters.from, to: filters.to }} onChange={(r) => set({ from: r.from, to: r.to })} max={todayYMD()} />
      ) : null}

      <AppDialog
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Filters"
        description="Narrow the register. The totals and charts follow along."
        footer={
          <>
            <Button variant="outline" onClick={() => set({ category: 'ALL', payment: 'ALL', search: '' })} disabled={!extras}>
              <X className="size-4" /> Clear
            </Button>
            <Button onClick={() => setSheetOpen(false)}>Done</Button>
          </>
        }
      >
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="exp-search-sm">Search</Label>
            {searchBox('exp-search-sm', 'Title or vendor…')}
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            {categorySelect}
          </div>
          <div className="space-y-1.5">
            <Label>Payment method</Label>
            {methodSelect}
          </div>
        </div>
      </AppDialog>
    </div>
  );
}
