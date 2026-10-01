'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CloudOff, Undo2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { companyTodayYMD } from '@/lib/expense';
import { formatYMD } from '@/lib/leave';

/** How far back the backend will accept a declaration (keep in step with leave.service.js). */
const BACKDATE_DAYS = 14;

function shiftYMD(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * CEO & President: shut the office for a day at short notice — weather, a power cut, a
 * bandh, a bereavement.
 *
 * Unlike the work-from-home day beside it, this accepts a date in the recent past: an
 * emergency is usually declared that evening or the next morning, once everyone is home.
 * It adds the day to the calendar as a holiday, which is what makes every rule treat it as
 * a day nobody was due in — no absence mark, no late mark, no overdue-task deduction, and a
 * punctual run carries straight across it instead of breaking.
 */
export function EmergencyHolidayDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [note, setNote] = React.useState('');
  const [result, setResult] = React.useState(null);

  const today = companyTodayYMD();
  React.useEffect(() => {
    if (open) { setDate(today); setTitle(''); setNote(''); setResult(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { data: daysData } = useQuery({
    queryKey: ['leaves', 'emergency-holiday'],
    queryFn: () => api.get('/leaves/emergency-holiday'),
    enabled: open,
  });
  const declared = (daysData?.days ?? []).slice().reverse();

  const refresh = () => {
    for (const key of [['leaves'], ['attendance'], ['dashboard'], ['announcements'], ['holidays'], ['calendar'], ['bonus'], ['reports'], ['activity']]) {
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const declareMut = useMutation({
    mutationFn: () => api.post('/leaves/emergency-holiday', { dateYMD: date, title, note }),
    onSuccess: (res) => {
      setResult(res);
      toast.success(`${res.title} declared for ${formatYMD(res.dateYMD)}`);
      refresh();
    },
    onError: (e) => toast.error(e?.message || 'Could not declare the holiday'),
  });

  const undoMut = useMutation({
    mutationFn: (d) => api.delete(`/leaves/emergency-holiday?dateYMD=${d}`),
    onSuccess: () => {
      toast.success('Emergency holiday removed');
      setResult(null);
      refresh();
    },
    onError: (e) => toast.error(e?.message || 'Could not undo'),
  });

  const moved = result?.points?.rows?.filter((r) => r.delta !== 0) ?? [];

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <CloudOff className="size-4" /> Emergency holiday
        </Button>
      }
      title="Declare an emergency holiday"
      description="Closes the office for one day and announces it. Nobody is marked absent or late, no overdue-task points are taken, and punctual streaks carry straight across the day."
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
          <Button onClick={() => declareMut.mutate()} disabled={!date || declareMut.isPending}>
            <CloudOff className="size-4" /> {declareMut.isPending ? 'Declaring…' : 'Declare holiday'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="eh-date">Date</Label>
          <DatePicker
            id="eh-date"
            value={date}
            min={shiftYMD(today, -BACKDATE_DAYS)}
            onChange={setDate}
            className="bg-background/50"
          />
          <p className="text-xs text-muted-foreground">
            Today, a day coming up, or any day in the last {BACKDATE_DAYS} — so a day the office
            had already closed can still be put right.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="eh-title">Reason</Label>
          <Input
            id="eh-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Heavy rain"
            className="bg-background/50"
          />
          <p className="text-xs text-muted-foreground">This is the name that shows on the calendar. Left blank, it reads “Emergency holiday”.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="eh-note">Announcement message (optional)</Label>
          <Textarea
            id="eh-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Office closed today — heavy rain. Stay safe, nothing is marked against anyone."
            className="bg-background/50"
          />
        </div>

        {date && date < today ? (
          <p className="rounded-xl bg-amber-500/[0.08] p-3 text-xs text-muted-foreground ring-1 ring-amber-500/20">
            <AlertTriangle className="mr-1 inline size-3.5 text-amber-500" />
            That day has already passed, so anything recorded against it is undone: absence and
            late marks are cleared and points are recalculated. If a punctual streak happened to
            finish on that exact day, the award moves to the person’s next on-time day — the run
            itself isn’t broken. You’ll see every change below before it goes anywhere else.
          </p>
        ) : null}

        {result ? (
          <div className="space-y-2 rounded-xl bg-primary/[0.06] p-3 text-sm ring-1 ring-primary/15">
            <p className="font-medium text-primary">
              {result.title} — {formatYMD(result.dateYMD)}{result.announced ? ' · announced' : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              {result.dripsCleared
                ? `${result.dripsCleared} overdue-task ${result.dripsCleared === 1 ? 'deduction' : 'deductions'} for that day cleared. `
                : ''}
              {moved.length
                ? `${moved.length} ${moved.length === 1 ? 'person’s' : 'people’s'} points changed:`
                : 'Nobody’s points changed.'}
            </p>
            {moved.length ? (
              <ul className="space-y-0.5 text-xs">
                {moved.map((r) => (
                  <li key={r.userId} className="flex items-baseline justify-between gap-2">
                    <span>{r.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {r.before} → <span className="font-medium text-foreground">{r.after}</span>
                      <span className={`ml-1.5 font-medium ${r.delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
                        {r.delta > 0 ? '+' : ''}{r.delta}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {declared.length ? (
          <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Declared so far</p>
            {declared.map((d) => (
              <div key={d} className="flex items-center justify-between gap-2">
                <span className="text-sm">{formatYMD(d)}</span>
                <Button size="sm" variant="ghost" onClick={() => undoMut.mutate(d)} disabled={undoMut.isPending}>
                  <Undo2 className="size-3.5" /> Undo
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}
