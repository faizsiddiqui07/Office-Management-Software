'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Repeat, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EVENT_TYPE_OPTIONS, todayYMDLocal } from '@/lib/calendar';

export function HolidayDialog({ open, onOpenChange, holiday, defaultStartYMD }) {
  const isEdit = !!holiday;
  const qc = useQueryClient();
  const [title, setTitle] = React.useState('');
  const [type, setType] = React.useState('HOLIDAY');
  const [start, setStart] = React.useState('');
  const [end, setEnd] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [repeats, setRepeats] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setTitle(holiday?.title || '');
    setType(holiday?.type || 'HOLIDAY');
    // Edit the entry, not the occurrence you happened to tap. Opening a birthday from
    // 2027 and saving must not move the date of birth to 2027.
    setStart(holiday?.anchorStartYMD || holiday?.startYMD || defaultStartYMD || '');
    setEnd(holiday?.anchorEndYMD || holiday?.endYMD || holiday?.startYMD || defaultStartYMD || '');
    setDesc(holiday?.description || '');
    setRepeats(holiday ? !!holiday.repeatsYearly : false);
  }, [open, holiday, defaultStartYMD]);

  const isBirthday = type === 'BIRTHDAY';
  // A birthday always comes back and is always one day — there is no other sensible
  // reading of it, so those two choices are made rather than asked.
  const effectiveRepeats = isBirthday ? true : repeats;

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        title,
        type,
        startYMD: start,
        endYMD: isBirthday ? start : end || start,
        description: desc,
        repeatsYearly: effectiveRepeats,
      };
      return isEdit ? api.put(`/holidays/${holiday.id}`, payload) : api.post('/holidays', payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Calendar entry updated' : 'Calendar entry added');
      qc.invalidateQueries({ queryKey: ['holidays'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not save'),
  });

  const delMut = useMutation({
    mutationFn: () => api.delete(`/holidays/${holiday.id}`),
    onSuccess: () => {
      toast.success('Calendar entry deleted');
      qc.invalidateQueries({ queryKey: ['holidays'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not delete'),
  });

  const submit = () => {
    if (!title.trim()) return toast.error('Add a title');
    if (!start) return toast.error(isBirthday ? 'Pick the date of birth' : 'Pick a date');
    if (isBirthday && start > todayYMDLocal()) return toast.error('A date of birth can’t be in the future');
    saveMut.mutate();
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit calendar entry' : 'Add calendar entry'}
      footer={
        <>
          {isEdit ? (
            <Button variant="ghost" className="mr-auto text-destructive" onClick={() => setConfirmingDelete(true)} disabled={delMut.isPending}>
              <Trash2 className="size-4" /> Delete
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Saving…' : isEdit ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
        <div className="space-y-1.5">
          <Label htmlFor="h-title">Title</Label>
          <Input id="h-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Independence Day" className="bg-background/50" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="h-type">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="h-type" className="w-full bg-background/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVENT_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isBirthday ? (
          <div className="space-y-1.5">
            <Label htmlFor="h-start">Date of birth</Label>
            <DatePicker
              id="h-start"
              value={start}
              min="1940-01-01"
              max={todayYMDLocal()}
              onChange={setStart}
              placeholder="Pick the date of birth"
              className="bg-background/50"
            />
            <p className="text-xs text-muted-foreground">
              Put the full date including the birth year. It shows every year from then on — and never in a year before it.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="h-start">From</Label>
              <DatePicker
                id="h-start"
                value={start}
                onChange={(v) => {
                  setStart(v);
                  if (!end || end < v) setEnd(v);
                }}
                className="bg-background/50"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="h-end">To</Label>
              <DatePicker id="h-end" value={end} min={start || undefined} onChange={setEnd} className="bg-background/50" />
            </div>
          </div>
        )}

        {/* Not offered for a birthday: it always repeats. Not defaulted on for anything
            else either — Diwali, Eid and Holi are holidays too, and they land on a
            different date every year. */}
        {isBirthday ? null : (
          <div className="flex items-start justify-between gap-3 rounded-xl bg-primary/[0.05] p-3 ring-1 ring-primary/15">
            <div className="min-w-0">
              <Label className="flex items-center gap-1.5">
                <Repeat className="size-3.5" /> Comes back every year
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {repeats
                  ? 'Shows on this date in every year — for 15 August, 26 January, 2 October.'
                  : 'Off — only this date. Keep it off for Diwali, Eid and Holi, which move every year.'}
              </p>
            </div>
            <Switch checked={repeats} onCheckedChange={setRepeats} />
          </div>
        )}

        {isEdit && holiday?.isRepeat ? (
          <p className="rounded-lg bg-foreground/[0.03] p-3 text-xs text-muted-foreground ring-1 ring-border/50">
            You opened this from {holiday.startYMD?.slice(0, 4)}, but the dates above are the original ones. Saving changes it in every year.
          </p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="h-desc">Description</Label>
          <Textarea id="h-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional details…" className="bg-background/50" />
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete this calendar entry?"
        description={holiday ? `“${holiday.title}” will be removed for everyone.` : ''}
        tone="destructive"
        confirmLabel="Delete"
        loading={delMut.isPending}
        onConfirm={() => delMut.mutate()}
      />
    </AppDialog>
  );
}
