'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { APP_LIVE_YMD } from '@/lib/app-live';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { roleName } from '@/lib/permissions';
import { rupeesToPaise, paiseToRupees, todayYMD } from '@/lib/expense';

/**
 * Shared dialog for logging a DUE / PAYMENT, or EDITING an existing one (pass `entry`).
 * In edit mode the person and kind are fixed — only amount/item/source/date/note change —
 * so it PUTs the correction instead of creating a new row, keeping the original date and
 * any partial settlement (the old delete-and-re-add lost both).
 */
export function DuesEntryDialog({ mode = 'due', entry = null, people = [], presetPerson = null, open, onOpenChange }) {
  const isEdit = !!entry;
  const isDue = isEdit ? entry.kind === 'DUE' : mode === 'due';
  const qc = useQueryClient();

  // Previously-used item/source values, offered as native datalist suggestions so
  // 'Lunch thali' / 'Sharma Dhaba' are picked once, not re-typed and mis-cased.
  const { data: sug } = useQuery({ queryKey: ['dues', 'suggest'], queryFn: () => api.get('/dues/suggest'), enabled: !!open && isDue });
  const itemSuggest = sug?.items ?? [];
  const sourceSuggest = sug?.sources ?? [];

  const [person, setPerson] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [item, setItem] = React.useState('');
  const [source, setSource] = React.useState('');
  const [date, setDate] = React.useState(todayYMD());
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setPerson(entry?.person || presetPerson || '');
    setAmount(entry ? paiseToRupees(entry.amount) : '');
    setItem(entry?.item || '');
    setSource(entry?.source || '');
    setDate(entry?.dateYMD || todayYMD());
    setNote(entry?.note || '');
  }, [open, entry, presetPerson]);

  const mut = useMutation({
    mutationFn: () => {
      // person + kind are fixed on an edit, so they aren't sent.
      const body = isDue
        ? { amount: rupeesToPaise(amount), item, source, dateYMD: date, note }
        : { amount: rupeesToPaise(amount), dateYMD: date, note };
      if (isEdit) return api.put(`/dues/${entry.id}`, body);
      return api.post(isDue ? '/dues/due' : '/dues/payment', { person, ...body });
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Entry updated' : isDue ? 'Due added' : 'Payment recorded');
      qc.invalidateQueries({ queryKey: ['dues'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not save'),
  });

  const submit = () => {
    if (!isEdit && !person) return toast.error('Pick a person');
    if (rupeesToPaise(amount) <= 0) return toast.error('Enter an amount');
    return mut.mutate();
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? (isDue ? 'Edit due' : 'Edit payment') : isDue ? 'Add a due' : 'Record a payment'}
      description={
        isEdit
          ? 'Correct this entry. The person and type can’t be changed.'
          : isDue
            ? 'Log something you brought for someone — they’ll owe this amount.'
            : 'Record cash received. Anything over their pending becomes advance.'
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : isEdit ? 'Save' : isDue ? 'Add due' : 'Record'}
          </Button>
        </>
      }
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto py-2">
        <div className="space-y-1.5">
          <Label>Person</Label>
          <Select value={person} onValueChange={setPerson} disabled={!!presetPerson || isEdit}>
            <SelectTrigger className="w-full bg-background/50">
              <SelectValue placeholder="Choose a person" />
            </SelectTrigger>
            <SelectContent>
              {people.map((p) => (
                <SelectItem key={p.person.id} value={p.person.id}>
                  {p.person.name} · {roleName(p.person)}
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
            <DatePicker id="d-date" value={date} min={APP_LIVE_YMD} max={todayYMD()} onChange={setDate} className="bg-background/50" />
          </div>
        </div>

        {isDue ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="d-item">What (item)</Label>
              <Input id="d-item" list="d-item-suggest" value={item} onChange={(e) => setItem(e.target.value)} placeholder="Lunch thali" className="bg-background/50" />
              <datalist id="d-item-suggest">{itemSuggest.map((v) => <option key={v} value={v} />)}</datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-src">From (source)</Label>
              <Input id="d-src" list="d-src-suggest" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Sharma Dhaba" className="bg-background/50" />
              <datalist id="d-src-suggest">{sourceSuggest.map((v) => <option key={v} value={v} />)}</datalist>
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
