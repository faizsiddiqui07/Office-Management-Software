'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PAYMENT_METHODS, categoryLabel, rupeesToPaise, paiseToRupees, todayYMD } from '@/lib/expense';

export function ExpenseDialog({ expense, open: openProp, onOpenChange }) {
  const isEdit = !!expense;
  const qc = useQueryClient();
  const [openInternal, setOpenInternal] = React.useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = onOpenChange || setOpenInternal;

  const { data: meta } = useQuery({ queryKey: ['expenses', 'meta'], queryFn: () => api.get('/expenses/meta') });
  const categories = meta?.categories ?? ['MISC'];

  const [title, setTitle] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [date, setDate] = React.useState(todayYMD());
  const [paymentMethod, setPaymentMethod] = React.useState('CASH');
  const [vendor, setVendor] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [receipt, setReceipt] = React.useState(null);

  React.useEffect(() => {
    if (!open) return;
    setTitle(expense?.title || '');
    setAmount(expense ? paiseToRupees(expense.amount) : '');
    setCategory(expense?.category || categories[0] || 'MISC');
    setDate(expense?.dateYMD || todayYMD());
    setPaymentMethod(expense?.paymentMethod || 'CASH');
    setVendor(expense?.vendor || '');
    setNotes(expense?.notes || '');
    setReceipt(null);
  }, [open, expense, categories]);

  const mut = useMutation({
    mutationFn: () => {
      const base = { title, amount: rupeesToPaise(amount), category, dateYMD: date, paymentMethod, vendor, notes };
      let payload = base;
      if (receipt) {
        const fd = new FormData();
        Object.entries(base).forEach(([k, v]) => fd.append(k, String(v)));
        fd.append('receipt', receipt);
        payload = fd;
      }
      return isEdit ? api.put(`/expenses/${expense.id}`, payload) : api.post('/expenses', payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Expense updated' : 'Expense added');
      qc.invalidateQueries({ queryKey: ['expenses'] });
      setOpen(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not save expense'),
  });

  const submit = () => {
    if (!title.trim()) return toast.error('Add a title');
    if (rupeesToPaise(amount) <= 0) return toast.error('Enter an amount');
    if (!category) return toast.error('Pick a category');
    mut.mutate();
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        isEdit ? undefined : (
          <Button className="w-full sm:w-auto">
            <Plus /> Add expense
          </Button>
        )
      }
      title={isEdit ? 'Edit expense' : 'Add expense'}
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : isEdit ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto py-2">
        <div className="space-y-1.5">
          <Label htmlFor="ex-title">Title</Label>
          <Input id="ex-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Printer paper" className="bg-background/50" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ex-amount">Amount (₹)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
              <Input id="ex-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="bg-background/50 pl-7" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ex-date">Date</Label>
            <Input id="ex-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-background/50" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ex-cat">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="ex-cat" className="w-full bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {categoryLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ex-pay">Payment method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger id="ex-pay" className="w-full bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ex-vendor">Vendor</Label>
          <Input id="ex-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Staples" className="bg-background/50" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ex-notes">Notes</Label>
          <Textarea id="ex-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional…" className="bg-background/50" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ex-receipt">Receipt (optional)</Label>
          <Input
            id="ex-receipt"
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setReceipt(e.target.files?.[0] || null)}
            className="bg-background/50 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
          />
          {isEdit && expense.receiptUrl ? <p className="text-xs text-muted-foreground">A receipt is already attached — upload to replace it.</p> : null}
        </div>
      </div>
    </AppDialog>
  );
}
