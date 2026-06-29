'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Paperclip, Pencil, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { DataTable } from '@/components/glass/data-table';
import { StatusBadge } from '@/components/glass/status-badge';
import { TableSkeleton } from '@/components/glass/skeletons';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ExpenseDialog } from './add-expense-dialog';
import { formatMoney, categoryLabel, PAYMENT_LABELS, PAYMENT_METHODS } from '@/lib/expense';
import { formatYMD } from '@/lib/leave';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function ExpenseTable({ canManage = true }) {
  const qc = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState('ALL');
  const [payment, setPayment] = React.useState('ALL');
  const [editing, setEditing] = React.useState(null);
  const [deleting, setDeleting] = React.useState(null);

  const { data: meta } = useQuery({ queryKey: ['expenses', 'meta'], queryFn: () => api.get('/expenses/meta') });
  const categories = meta?.categories ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', 'list', search, category, payment],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' });
      if (search) params.set('search', search);
      if (category !== 'ALL') params.set('category', category);
      if (payment !== 'ALL') params.set('paymentMethod', payment);
      return api.get(`/expenses?${params.toString()}`);
    },
  });
  const expenses = data?.expenses ?? [];

  const delMut = useMutation({
    mutationFn: (id) => api.delete(`/expenses/${id}`),
    onSuccess: () => {
      toast.success('Expense deleted');
      qc.invalidateQueries({ queryKey: ['expenses'] });
      setDeleting(null);
    },
    onError: (e) => toast.error(e?.message || 'Could not delete'),
  });

  const columns = React.useMemo(
    () => [
      { id: 'date', header: 'Date', accessorFn: (r) => r.dateYMD, cell: ({ row }) => formatYMD(row.original.dateYMD) },
      {
        id: 'title',
        header: 'Title',
        accessorFn: (r) => `${r.title} ${r.vendor}`,
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.title}</p>
            {row.original.vendor ? <p className="text-xs text-muted-foreground">{row.original.vendor}</p> : null}
          </div>
        ),
      },
      {
        id: 'category',
        header: 'Category',
        cell: ({ row }) => (
          <StatusBadge tone="primary" dot={false}>
            {categoryLabel(row.original.category)}
          </StatusBadge>
        ),
      },
      {
        id: 'payment',
        header: 'Method',
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{PAYMENT_LABELS[row.original.paymentMethod] ?? row.original.paymentMethod}</span>,
      },
      { id: 'amount', header: 'Amount', cell: ({ row }) => <span className="font-medium tabular-nums">{formatMoney(row.original.amount)}</span> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-0.5">
            {row.original.receiptUrl ? (
              <a
                href={`${API_BASE}${row.original.receiptUrl}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
                aria-label="View receipt"
              >
                <Paperclip className="size-4" />
              </a>
            ) : null}
            {canManage ? (
              <>
                <Button variant="ghost" size="icon" onClick={() => setEditing(row.original)} aria-label="Edit">
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleting(row.original)} aria-label="Delete">
                  <Trash2 className="size-4" />
                </Button>
              </>
            ) : null}
          </div>
        ),
      },
    ],
    [canManage],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or vendor…" className="h-9 bg-background/50 pl-9" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9 w-full bg-background/50 sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {categoryLabel(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={payment} onValueChange={setPayment}>
          <SelectTrigger className="h-9 w-full bg-background/50 sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All methods</SelectItem>
            {PAYMENT_METHODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage ? (
          <div className="w-full sm:ml-auto sm:w-auto">
            <ExpenseDialog />
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : (
        <DataTable columns={columns} data={expenses} searchable={false} pageSize={12} emptyMessage="No expenses found." />
      )}

      {editing ? (
        <ExpenseDialog
          expense={editing}
          open={!!editing}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete this expense?"
        description={deleting ? `"${deleting.title}" · ${formatMoney(deleting.amount)} will be removed.` : ''}
        tone="destructive"
        confirmLabel="Delete"
        loading={delMut.isPending}
        onConfirm={() => deleting && delMut.mutate(deleting.id)}
      />
    </div>
  );
}
