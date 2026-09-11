'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Repeat } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TimePicker } from '@/components/ui/time-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRoleOptions } from '@/lib/use-roles';
import { PRIORITY_OPTIONS, RECURRENCE_OPTIONS, WEEKDAYS, MONTHS, describeRecurrence } from '@/lib/announcement';

const EMPTY_RULE = { type: 'NONE', weekday: null, dayOfMonth: null, month: null, time: '09:00' };
const DAYS_1_31 = Array.from({ length: 31 }, (_, i) => i + 1);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function CreateAnnouncementDialog({ announcement, open: openProp, onOpenChange }) {
  const isEdit = !!announcement;
  const qc = useQueryClient();
  const [openInternal, setOpenInternal] = React.useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = onOpenChange || setOpenInternal;

  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [priority, setPriority] = React.useState('NORMAL');
  const [audience, setAudience] = React.useState([]); // empty = everyone
  // Repeats: every week / month / year, at a time (company timezone). The server owns
  // when it actually goes out — this only collects the rule.
  const [recur, setRecur] = React.useState(EMPTY_RULE);
  const { data: roleOptions = [] } = useRoleOptions();
  const setRule = (patch) => setRecur((r) => ({ ...r, ...patch }));

  React.useEffect(() => {
    if (open && isEdit) {
      setTitle(announcement.title || '');
      setBody(announcement.body || '');
      setPriority(announcement.priority || 'NORMAL');
      setAudience(announcement.audienceRoles || []);
      // An older post has no recurrence at all — read that as "doesn't repeat".
      setRecur({ ...EMPTY_RULE, ...(announcement.recurrence?.type ? announcement.recurrence : {}) });
    }
    if (open && !isEdit) {
      setTitle('');
      setBody('');
      setPriority('NORMAL');
      setAudience([]);
      setRecur(EMPTY_RULE);
    }
  }, [open, isEdit, announcement]);

  const mut = useMutation({
    mutationFn: () => {
      // Only the fields the chosen type uses — the server drops the rest anyway, but a
      // clean payload is easier to read in the activity log.
      const recurrence = { type: recur.type, time: recur.time || '09:00' };
      if (recur.type === 'WEEKLY') recurrence.weekday = recur.weekday;
      if (recur.type === 'MONTHLY') recurrence.dayOfMonth = recur.dayOfMonth;
      if (recur.type === 'YEARLY') { recurrence.month = recur.month; recurrence.dayOfMonth = recur.dayOfMonth; }
      const payload = { title, body, priority, audienceRoles: audience, recurrence };
      if (!isEdit) return api.post('/announcements', payload);
      // On edit, send only what actually changed. The activity log records the field
      // names, and "changed title, body, priority, audience, recurrence" on every save
      // — including a one-word title fix — would make that record worthless.
      const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
      const before = {
        title: announcement.title || '',
        body: announcement.body || '',
        priority: announcement.priority || 'NORMAL',
        audienceRoles: announcement.audienceRoles || [],
        recurrence: announcement.recurrence?.type
          ? { type: announcement.recurrence.type, time: announcement.recurrence.time || '09:00',
              ...(announcement.recurrence.type === 'WEEKLY' ? { weekday: announcement.recurrence.weekday } : {}),
              ...(announcement.recurrence.type === 'MONTHLY' ? { dayOfMonth: announcement.recurrence.dayOfMonth } : {}),
              ...(announcement.recurrence.type === 'YEARLY' ? { month: announcement.recurrence.month, dayOfMonth: announcement.recurrence.dayOfMonth } : {}) }
          : { type: 'NONE', time: '09:00' },
      };
      const diff = {};
      for (const k of Object.keys(payload)) if (!same(payload[k], before[k])) diff[k] = payload[k];
      return api.put(`/announcements/${announcement.id}`, diff);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Announcement updated' : 'Announcement posted');
      qc.invalidateQueries({ queryKey: ['announcements'] });
      setOpen(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not save announcement'),
  });

  const submit = () => {
    if (!title.trim()) return toast.error('Add a title');
    // The same three checks the server makes, so a half-filled rule is caught here with
    // a plain message instead of coming back as a validation error.
    if (recur.type === 'WEEKLY' && recur.weekday == null) return toast.error('Pick which day of the week it repeats on');
    if (recur.type === 'MONTHLY' && recur.dayOfMonth == null) return toast.error('Pick which date of the month it repeats on');
    if (recur.type === 'YEARLY' && (recur.month == null || recur.dayOfMonth == null)) return toast.error('Pick the month and the date it repeats on');
    if (recur.type !== 'NONE' && !HHMM.test(recur.time || '')) return toast.error('Pick a time for it to go out');
    mut.mutate();
  };

  const summary = describeRecurrence(recur);
  // "The 31st" has to mean something in April. Said here, once, so nobody is surprised.
  // Monthly only: a yearly date names its own month, so it cannot land in a shorter one
  // except 29 February — which gets its own line.
  const clampNote = recur.type === 'MONTHLY' && recur.dayOfMonth >= 29
    ? 'In a shorter month it goes out on the last day instead.'
    : recur.type === 'YEARLY' && recur.month === 2 && recur.dayOfMonth === 29
      ? 'In a year without a 29 February it goes out on the 28th.'
      : '';

  const toggleRole = (r) =>
    setAudience((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        isEdit ? undefined : (
          <Button>
            <Plus /> New announcement
          </Button>
        )
      }
      title={isEdit ? 'Edit announcement' : 'New announcement'}
      description="Posted notices pop up for the audience on next login and live in the feed."
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Post announcement'}
          </Button>
        </>
      }
    >
      <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
        <div className="space-y-1.5">
          <Label htmlFor="an-title">Title</Label>
          <Input id="an-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Office closed on Monday" className="bg-background/50" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="an-body">Message</Label>
          <Textarea id="an-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write the announcement…" className="min-h-28 bg-background/50" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="an-priority">Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger id="an-priority" className="w-full bg-background/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Audience {audience.length === 0 ? '· Everyone' : ''}</Label>
          <div className="flex flex-wrap gap-1.5">
            {roleOptions.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => toggleRole(r.key)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
                  audience.includes(r.key)
                    ? 'bg-primary/12 text-primary ring-primary/25'
                    : 'bg-muted/40 text-muted-foreground ring-border hover:text-foreground',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Leave none selected to notify everyone.</p>
        </div>

        {/* Repeats — the same post going out again on a schedule: every week on a day,
            every month on a date, or every year on a month-and-date. Each time it goes
            out it pops up for everyone again and returns to the top of the feed. */}
        <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
          <Label htmlFor="an-repeat" className="flex items-center gap-1.5">
            <Repeat className="size-3.5" /> Repeat
          </Label>
          <Select value={recur.type} onValueChange={(v) => setRule({ type: v })}>
            <SelectTrigger id="an-repeat" className="w-full bg-background/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RECURRENCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {recur.type === 'WEEKLY' ? (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">On</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setRule({ weekday: i })}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
                      recur.weekday === i ? 'bg-primary/12 text-primary ring-primary/25' : 'bg-muted/40 text-muted-foreground ring-border hover:text-foreground',
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {recur.type === 'MONTHLY' || recur.type === 'YEARLY' ? (
            <div className="flex flex-wrap gap-3">
              {recur.type === 'YEARLY' ? (
                <div className="min-w-[10rem] flex-1 space-y-1.5">
                  <Label htmlFor="an-month" className="text-xs text-muted-foreground">Month</Label>
                  <Select value={recur.month != null ? String(recur.month) : null} onValueChange={(v) => setRule({ month: Number(v) })}>
                    <SelectTrigger id="an-month" className="w-full bg-background/50"><span>{recur.month != null ? MONTHS[recur.month - 1] : 'Pick a month'}</span></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="min-w-[8rem] flex-1 space-y-1.5">
                <Label htmlFor="an-dom" className="text-xs text-muted-foreground">Date</Label>
                <Select value={recur.dayOfMonth != null ? String(recur.dayOfMonth) : null} onValueChange={(v) => setRule({ dayOfMonth: Number(v) })}>
                  <SelectTrigger id="an-dom" className="w-full bg-background/50"><span>{recur.dayOfMonth != null ? recur.dayOfMonth : 'Pick a date'}</span></SelectTrigger>
                  <SelectContent>
                    {DAYS_1_31.map((d) => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {recur.type !== 'NONE' ? (
            <div className="space-y-1.5">
              <Label htmlFor="an-time" className="text-xs text-muted-foreground">At</Label>
              {/* The app's own picker, not a bare native input — it stores HH:mm, never
                  an empty string, so "Pick a time" can't be asked of somebody looking at
                  a time. */}
              <TimePicker id="an-time" value={recur.time || '09:00'} onChange={(v) => setRule({ time: v || '09:00' })} className="bg-background/50" />
            </div>
          ) : null}

          {summary ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{summary}.</span> It goes out again on each of those days, pops up for
              everyone as new, and returns to the top of the feed.{clampNote ? ` ${clampNote}` : ''}
            </p>
          ) : null}
        </div>
      </div>
    </AppDialog>
  );
}
