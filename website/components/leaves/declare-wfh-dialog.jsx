'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Home, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { companyTodayYMD } from '@/lib/expense';
import { formatYMD } from '@/lib/leave';

/**
 * CEO & President: declare one day as work-from-home for the whole office.
 *
 * One press marks everyone's attendance for that day and posts the announcement, so
 * nobody has to apply and nobody has to be told separately. It spends nobody's personal
 * yearly allowance — the office decided it — and it can be undone again.
 */
export function DeclareWfhDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState('');
  const [note, setNote] = React.useState('');
  const [result, setResult] = React.useState(null);

  React.useEffect(() => {
    if (open) { setDate(companyTodayYMD()); setNote(''); setResult(null); }
  }, [open]);

  const { data: daysData } = useQuery({
    queryKey: ['leaves', 'wfh', 'days'],
    queryFn: () => api.get('/leaves/wfh/days'),
    enabled: open,
  });
  const declared = daysData?.days ?? [];
  const today = companyTodayYMD();
  const upcoming = declared.filter((d) => d >= today);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['leaves'] });
    qc.invalidateQueries({ queryKey: ['attendance'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['announcements'] });
  };

  const declareMut = useMutation({
    mutationFn: () => api.post('/leaves/wfh/declare', { dateYMD: date, note }),
    onSuccess: (res) => {
      setResult(res);
      toast.success(`Work from home declared for ${res.appliedCount} ${res.appliedCount === 1 ? 'person' : 'people'}`);
      refresh();
    },
    onError: (e) => toast.error(e?.message || 'Could not declare the day'),
  });

  const undoMut = useMutation({
    mutationFn: (d) => api.delete(`/leaves/wfh/declare?dateYMD=${d}`),
    onSuccess: (res) => {
      toast.success(res.removed ? `Undone — ${res.removed} ${res.removed === 1 ? 'day' : 'days'} cleared` : 'Nothing left to undo');
      setResult(null);
      refresh();
    },
    onError: (e) => toast.error(e?.message || 'Could not undo'),
  });

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <Building2 className="size-4" /> Declare WFH day
        </Button>
      }
      title="Declare a work-from-home day"
      description="Marks the whole office as working from home for one day and announces it. Nobody needs to apply, and it doesn’t use anyone’s 2 personal days."
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
          <Button onClick={() => declareMut.mutate()} disabled={!date || declareMut.isPending}>
            <Home className="size-4" /> {declareMut.isPending ? 'Declaring…' : 'Declare'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="wfh-date">Date</Label>
          <DatePicker id="wfh-date" value={date} min={today} onChange={setDate} className="bg-background/50" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wfh-note">Announcement message (optional)</Label>
          <Textarea
            id="wfh-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Heavy rain expected — everyone works from home tomorrow."
            className="bg-background/50"
          />
          <p className="text-xs text-muted-foreground">Left blank, a standard message goes out.</p>
        </div>

        {/* Who it actually landed on, and who it skipped and why — a declaration that
            silently misses somebody would leave them marked absent. */}
        {result ? (
          <div className="space-y-2 rounded-xl bg-primary/[0.06] p-3 text-sm ring-1 ring-primary/15">
            <p className="font-medium text-primary">
              Marked for {result.appliedCount} {result.appliedCount === 1 ? 'person' : 'people'} on {formatYMD(result.dateYMD)}
              {result.announced ? ' · announced' : ' · already announced'}
            </p>
            {result.skipped?.length ? (
              <div className="text-xs text-muted-foreground">
                <p className="mb-0.5 font-medium">Not applied to:</p>
                <ul className="space-y-0.5">
                  {result.skipped.map((s) => (
                    <li key={s.name}>· {s.name} — {s.why}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {upcoming.length ? (
          <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Declared days</p>
            {upcoming.map((d) => (
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
