'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileText, LogOut, Pencil, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { DataTable } from '@/components/glass/data-table';
import { StatusBadge } from '@/components/glass/status-badge';
import { TableSkeleton } from '@/components/glass/skeletons';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import { AppDialog } from '@/components/glass/app-dialog';
import { COMPANY_TZ } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { VisitorDialog } from './visitor-dialog';
import { CategoryManager } from './category-manager';
import { downloadVisitors } from '@/lib/visitor';
import { formatYMD } from '@/lib/leave';

/** Current wall-clock "HH:mm" in the company timezone (for one-tap check-out). */
function nowHM() {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: COMPANY_TZ }).format(new Date());
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words text-right text-sm font-medium">{value || '—'}</span>
    </div>
  );
}

export function VisitorTable({ canManageCategories = false }) {
  const qc = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [category, setCategory] = React.useState('ALL');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [editing, setEditing] = React.useState(null);
  const [deleting, setDeleting] = React.useState(null);
  const [selected, setSelected] = React.useState(null); // row-click detail view
  const [busy, setBusy] = React.useState('');

  // Debounce the search so the table doesn't refetch (and flash) per keystroke.
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: meta } = useQuery({ queryKey: ['visitors', 'meta'], queryFn: () => api.get('/visitors/meta') });
  const categories = meta?.categories ?? [];

  const filters = React.useMemo(
    () => ({ search: debouncedSearch || '', category: category !== 'ALL' ? category : '', from, to }),
    [debouncedSearch, category, from, to],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['visitors', 'list', filters],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '500', sort: 'date_desc' });
      if (filters.search) params.set('search', filters.search);
      if (filters.category) params.set('category', filters.category);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      return api.get(`/visitors?${params.toString()}`);
    },
    placeholderData: (prev) => prev, // keep previous rows visible while refetching
  });
  const visitors = data?.visitors ?? [];

  const checkoutMut = useMutation({
    mutationFn: (v) => api.put(`/visitors/${v.id}`, { checkOutTime: nowHM() }),
    onSuccess: (_res, v) => {
      toast.success(`${v.name} checked out`);
      qc.invalidateQueries({ queryKey: ['visitors'] });
      setSelected(null);
    },
    onError: (e) => toast.error(e?.message || 'Could not check out'),
  });

  const delMut = useMutation({
    mutationFn: (id) => api.delete(`/visitors/${id}`),
    onSuccess: () => {
      toast.success('Entry deleted');
      qc.invalidateQueries({ queryKey: ['visitors'] });
      setDeleting(null);
    },
    onError: (e) => toast.error(e?.message || 'Could not delete'),
  });

  const download = async (format) => {
    setBusy(format);
    try {
      await downloadVisitors(format, filters);
    } catch (e) {
      toast.error(e?.message || 'Could not download');
    } finally {
      setBusy('');
    }
  };

  const columns = React.useMemo(
    () => [
      { id: 'date', header: 'Date', accessorFn: (r) => r.dateYMD, cell: ({ row }) => formatYMD(row.original.dateYMD) },
      {
        id: 'time',
        header: 'In / Out',
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 whitespace-nowrap text-sm tabular-nums">
            {row.original.checkInTime || '—'}
            {row.original.checkOutTime ? (
              <span className="text-muted-foreground">→ {row.original.checkOutTime}</span>
            ) : (
              <StatusBadge tone="success">In office</StatusBadge>
            )}
          </span>
        ),
      },
      {
        id: 'name',
        header: 'Visitor',
        accessorFn: (r) => `${r.name} ${r.phone} ${r.company}`,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.name}</p>
            {row.original.phone ? <p className="truncate text-xs text-muted-foreground">{row.original.phone}</p> : null}
          </div>
        ),
      },
      {
        id: 'category',
        header: 'Category',
        cell: ({ row }) => (
          <StatusBadge tone="primary" dot={false}>
            {row.original.category}
          </StatusBadge>
        ),
      },
      { id: 'from', header: 'From', cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.fromPlace || '—'}</span> },
      { id: 'company', header: 'Who / Company', cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.company || '—'}</span> },
      { id: 'toMeet', header: 'To meet', cell: ({ row }) => <span className="text-sm">{row.original.toMeet || '—'}</span> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1.5">
            {!row.original.checkOutTime ? (
              <Button
                variant="outline"
                className="h-10 sm:h-8"
                disabled={checkoutMut.isPending}
                onClick={(e) => { e.stopPropagation(); checkoutMut.mutate(row.original); }}
              >
                <LogOut className="size-4" /> Check out
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" className="size-10 sm:size-8" onClick={(e) => { e.stopPropagation(); setEditing(row.original); }} aria-label="Edit">
              <Pencil className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-10 text-destructive sm:size-8" onClick={(e) => { e.stopPropagation(); setDeleting(row.original); }} aria-label="Delete">
              <Trash2 className="size-4" />
            </Button>
          </div>
        ),
      },
    ],
    [checkoutMut],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, company, phone…" className="h-9 bg-background/50 pl-9" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9 w-full bg-background/50 sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-full bg-background/50 sm:w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 w-full bg-background/50 sm:w-40" />
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <Button variant="outline" onClick={() => download('csv')} disabled={busy === 'csv'} className="flex-1 sm:flex-none">
            <Download className="size-4" /> {busy === 'csv' ? '…' : 'CSV'}
          </Button>
          <Button variant="outline" onClick={() => download('pdf')} disabled={busy === 'pdf'} className="flex-1 sm:flex-none">
            <FileText className="size-4" /> {busy === 'pdf' ? '…' : 'PDF'}
          </Button>
          {canManageCategories ? <CategoryManager /> : null}
          <VisitorDialog />
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : (
        <DataTable
          columns={columns}
          data={visitors}
          searchable={false}
          pageSize={15}
          emptyMessage="No visitor entries yet — log the first one."
          onRowClick={setSelected}
        />
      )}

      {/* Row-click detail — every field, including the purpose/notes. */}
      <AppDialog
        open={!!selected}
        onOpenChange={(o) => (!o ? setSelected(null) : null)}
        title={selected?.name}
        description={selected ? `${formatYMD(selected.dateYMD)} · ${selected.category}` : undefined}
        footer={
          selected && !selected.checkOutTime ? (
            <Button disabled={checkoutMut.isPending} onClick={() => checkoutMut.mutate(selected)}>
              <LogOut className="size-4" /> {checkoutMut.isPending ? 'Checking out…' : 'Check out now'}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
          )
        }
      >
        {selected ? (
          <div className="divide-y divide-border/50 py-1">
            <DetailRow label="In / Out" value={`${selected.checkInTime || '—'} → ${selected.checkOutTime || 'still in office'}`} />
            <DetailRow label="Phone" value={selected.phone} />
            <DetailRow label="From" value={selected.fromPlace} />
            <DetailRow label="Who / Company" value={selected.company} />
            <DetailRow label="To meet" value={selected.toMeet} />
            <DetailRow label="Purpose / notes" value={selected.purpose} />
            <DetailRow label="Logged by" value={selected.createdBy?.name} />
          </div>
        ) : null}
      </AppDialog>

      {editing ? (
        <VisitorDialog visitor={editing} open={!!editing} onOpenChange={(o) => (!o ? setEditing(null) : null)} />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => (!o ? setDeleting(null) : null)}
        title="Delete this entry?"
        description={deleting ? `${deleting.name}'s visit on ${deleting.dateYMD} will be removed.` : ''}
        tone="destructive"
        confirmLabel="Delete"
        loading={delMut.isPending}
        onConfirm={() => deleting && delMut.mutate(deleting.id)}
      />
    </div>
  );
}
