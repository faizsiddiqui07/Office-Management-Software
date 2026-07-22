'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { TimePicker } from '@/components/ui/time-picker';
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
import { PersonAutocomplete } from './person-autocomplete';
import { todayYMD, nowHM } from '@/lib/visitor';

export function VisitorDialog({ visitor, open: openProp, onOpenChange }) {
  const isEdit = !!visitor;
  const qc = useQueryClient();
  const [openInternal, setOpenInternal] = React.useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = onOpenChange || setOpenInternal;

  // Once a visitor has checked out, their visit times are a finalised record — you can
  // still fix any other detail, but the check-in / check-out time is locked.
  const timesLocked = isEdit && !!visitor?.checkOutTime;

  const { data: meta } = useQuery({ queryKey: ['visitors', 'meta'], queryFn: () => api.get('/visitors/meta') });
  const categories = meta?.categories ?? ['Visitors', 'Finance'];
  const { data: peopleData } = useQuery({ queryKey: ['visitors', 'people'], queryFn: () => api.get('/visitors/people'), staleTime: 5 * 60 * 1000 });
  const people = peopleData?.people ?? [];

  const [form, setForm] = React.useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Same, but for the app's own pickers — they hand back the value, not an event.
  const setV = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  React.useEffect(() => {
    if (!open) return;
    setForm({
      name: visitor?.name || '',
      phone: visitor?.phone || '',
      category: visitor?.category || categories[0] || 'Visitors',
      fromPlace: visitor?.fromPlace || '',
      company: visitor?.company || '',
      toMeet: visitor?.toMeet || '',
      purpose: visitor?.purpose || '',
      dateYMD: visitor?.dateYMD || todayYMD(),
      checkInTime: visitor?.checkInTime || nowHM(),
      checkOutTime: visitor?.checkOutTime || '',
    });
  }, [open, visitor]); // eslint-disable-line react-hooks/exhaustive-deps

  const mut = useMutation({
    mutationFn: () => (isEdit ? api.put(`/visitors/${visitor.id}`, form) : api.post('/visitors', form)),
    onSuccess: () => {
      toast.success(isEdit ? 'Entry updated' : 'Visitor logged');
      qc.invalidateQueries({ queryKey: ['visitors'] });
      setOpen(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not save the entry'),
  });

  const submit = () => {
    if (!form.name?.trim()) return toast.error('Add the visitor’s name');
    if (!form.category) return toast.error('Pick a category');
    if (form.checkInTime && form.checkOutTime && form.checkOutTime <= form.checkInTime) {
      return toast.error('Check-out time must be after check-in');
    }
    mut.mutate();
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        isEdit ? undefined : (
          <Button className="w-full sm:w-auto">
            <Plus /> New entry
          </Button>
        )
      }
      title={isEdit ? 'Edit visitor entry' : 'New visitor entry'}
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : isEdit ? 'Save' : 'Log entry'}
          </Button>
        </>
      }
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto py-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="v-name">Visitor name</Label>
            <Input id="v-name" value={form.name || ''} onChange={set('name')} placeholder="Rahul Sharma" className="bg-background/50" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-phone">Phone</Label>
            <Input id="v-phone" type="tel" inputMode="tel" value={form.phone || ''} onChange={set('phone')} placeholder="Optional" className="bg-background/50" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="v-cat">Category</Label>
            <Select value={form.category || ''} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
              <SelectTrigger id="v-cat" className="w-full bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-meet">Whom to meet</Label>
            <PersonAutocomplete
              id="v-meet"
              value={form.toMeet || ''}
              onChange={(v) => setForm((f) => ({ ...f, toMeet: v }))}
              people={people}
              placeholder="Start typing a name…"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="v-from">Coming from</Label>
            <Input id="v-from" value={form.fromPlace || ''} onChange={set('fromPlace')} placeholder="City / place" className="bg-background/50" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-company">Who / Company</Label>
            <Input id="v-company" value={form.company || ''} onChange={set('company')} placeholder="e.g. ABC Corp / Client" className="bg-background/50" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="v-date">Date</Label>
            <DatePicker id="v-date" value={form.dateYMD || ''} min={APP_LIVE_YMD} max={todayYMD()} onChange={setV('dateYMD')} className="bg-background/50" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-in">Check-in</Label>
            <TimePicker id="v-in" value={form.checkInTime || ''} onChange={setV('checkInTime')} disabled={timesLocked} className="bg-background/50 disabled:cursor-not-allowed disabled:opacity-60" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-out">Check-out</Label>
            <TimePicker id="v-out" value={form.checkOutTime || ''} onChange={setV('checkOutTime')} disabled={timesLocked} className="bg-background/50 disabled:cursor-not-allowed disabled:opacity-60" />
          </div>
        </div>
        {timesLocked ? (
          <p className="-mt-1.5 text-xs text-muted-foreground">
            Check-in &amp; check-out times are locked once the visitor has checked out. You can still update every other detail.
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="v-purpose">Purpose / notes</Label>
          <Textarea id="v-purpose" value={form.purpose || ''} onChange={set('purpose')} placeholder="Optional…" className="bg-background/50" />
        </div>
      </div>
    </AppDialog>
  );
}
