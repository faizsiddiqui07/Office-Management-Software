'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { prettyRole } from '@/lib/permissions';
import { rupeesToPaise, todayYMD } from '@/lib/expense';

/** Shared dialog for logging a DUE (something brought for someone) or a PAYMENT. */
export function DuesEntryDialog({ mode = 'due', people = [], presetPerson = null, open, onOpenChange }) {
  const isDue = mode === 'due';
  const qc = useQueryClient();

  const [person, setPerson] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [item, setItem] = React.useState('');
  const [source, setSource] = React.useState('');
  const [date, setDate] = React.useState(todayYMD());
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setPerson(presetPerson || '');
    setAmount('');
    setItem('');
    setSource('');
    setDate(todayYMD());
    setNote('');
  }, [open, presetPerson]);

  const mut = useMutation({
    mutationFn: () => {
      const body = isDue
        ? { person, amount: rupeesToPaise(amount), item, source, dateYMD: date, note }
        : { person, amount: rupeesToPaise(amount), dateYMD: date, note };
      return api.post(isDue ? '/dues/due' : '/dues/payment', body);
    },
    onSuccess: () => {
      toast.success(isDue ? 'Due added' : 'Payment recorded');
      qc.invalidateQueries({ queryKey: ['dues'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not save'),
  });

  const submit = () => {
    if (!person) return toast.error('Pick a person');
    if (rupeesToPaise(amount) <= 0) return toast.error('Enter an amount');
    return mut.mutate();
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isDue ? 'Add a due' : 'Record a payment'}
      description={
        isDue
          ? 'Log something you brought for someone — they’ll owe this amount.'
          : 'Record cash received. Anything over their pending becomes advance.'
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : isDue ? 'Add due' : 'Record'}
          </Button>
        </>
      }
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto py-2">
        <div className="space-y-1.5">
          <Label>Person</Label>
          <Select value={person} onValueChange={setPerson} disabled={!!presetPerson}>
            <SelectTrigger className="w-full bg-background/50">
              <SelectValue placeholder="Choose a person" />
            </SelectTrigger>
            <SelectContent>
              {people.map((p) => (
                <SelectItem key={p.person.id} value={p.person.id}>
                  {p.person.name} · {prettyRole(p.person.role)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="d-amt">Amount (₹)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
              <Input id="d-amt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="bg-background/50 pl-7" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-date">Date</Label>
            <Input id="d-date" type="date" value={date} max={todayYMD()} onChange={(e) => setDate(e.target.value)} className="bg-background/50" />
          </div>
        </div>

        {isDue ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="d-item">What (item)</Label>
              <Input id="d-item" value={item} onChange={(e) => setItem(e.target.value)} placeholder="Lunch thali" className="bg-background/50" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-src">From (source)</Label>
              <Input id="d-src" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Sharma Dhaba" className="bg-background/50" />
            </div>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="d-note">Note</Label>
          <Textarea id="d-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional…" className="bg-background/50" />
        </div>
      </div>
    </AppDialog>
  );
}
