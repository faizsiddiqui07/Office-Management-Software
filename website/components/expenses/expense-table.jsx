'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { DataTable } from '@/components/glass/data-table';
import { StatusBadge } from '@/components/glass/status-badge';
import { TableSkeleton } from '@/components/glass/skeletons';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import { Button } from '@/components/ui/button';
import { ExpenseDialog } from './add-expense-dialog';
import { formatMoney, categoryLabel, PAYMENT_LABELS } from '@/lib/expense';
import { formatYMD } from '@/lib/leave';

/**
 * Rows only — every control lives in the filter bar at the top of the page now, and
 * `range` is the window the SERVER resolved for the summary. Reusing it (rather than
 * working the dates out again here) is what makes the table and the totals above it
 * provably the same slice.
 */
export function ExpenseTable({ canManage = true, filters, search = '', range }) {
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState(null);
  const [deleting, setDeleting] = React.useState(null);

  const category = filters?.category ?? 'ALL';
  const payment = filters?.payment ?? 'ALL';
  const from = range?.from ?? '';
  const to = range?.to ?? '';

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', 'list', search, category, payment, from, to],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' });
      if (search) params.set('search', search);
      if (category !== 'ALL') params.set('category', category);
      if (payment !== 'ALL') params.set('paymentMethod', payment);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return api.get(`/expenses?${params.toString()}`);
    },
    enabled: !!range, // wait for the resolved period rather than briefly loading everything
    placeholderData: (prev) => prev, // keep rows visible while refetching
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
        accessorFn: (r) => `${r.title} ${r.vendor || ''}`,
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
        accessorFn: (r) => categoryLabel(r.category),
        cell: ({ row }) => (
          <StatusBadge tone="primary" dot={false}>
            {categoryLabel(row.original.category)}
          </StatusBadge>
        ),
      },
      {
        id: 'payment',
        header: 'Method',
        accessorFn: (r) => PAYMENT_LABELS[r.paymentMethod] ?? r.paymentMethod,
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{PAYMENT_LABELS[row.original.paymentMethod] ?? row.original.paymentMethod}</span>,
      },
      { id: 'amount', header: 'Amount', accessorFn: (r) => r.amount, cell: ({ row }) => <span className="font-medium tabular-nums">{formatMoney(row.original.amount)}</span> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-0.5">
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
      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : (
        <>
          <DataTable columns={columns} data={expenses} searchable={false} pageSize={12} emptyMessage="No expenses found." />
          {(data?.total ?? 0) > expenses.length ? (
            <p className="px-1 text-xs text-muted-foreground">
              Showing {expenses.length} of {data.total} — narrow the search or filters to see the rest.
            </p>
          ) : null}
        </>
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
