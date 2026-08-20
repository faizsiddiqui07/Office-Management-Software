'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { TimePicker } from '@/components/ui/time-picker';
import { APP_LIVE_YMD } from '@/lib/app-live';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { todayYMD } from '@/lib/time';

/**
 * Attendance-correction request dialog.
 *
 * With no props it's the plain "Request correction" button. A caller can also seed it
 * from a specific day — e.g. the attendance history offering a one-tap fix for a day
 * where someone forgot to check out — by passing `prefill` (date / times / reason) and
 * its own `trigger`.
 */
export function RegularizationDialog({ prefill = null, trigger = null } = {}) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState(todayYMD());
  const [checkIn, setCheckIn] = React.useState('');
  const [checkOut, setCheckOut] = React.useState('');
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    // Re-seed from the prefill each time it opens, falling back to a blank today form.
    setDate(prefill?.dateYMD || todayYMD());
    setCheckIn(prefill?.checkIn || '');
    setCheckOut(prefill?.checkOut || '');
    setReason(prefill?.reason || '');
    // prefill is a plain object rebuilt per render; depend on its fields, not identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill?.dateYMD, prefill?.checkIn, prefill?.checkOut, prefill?.reason]);

  const mut = useMutation({
    mutationFn: () =>
      api.post('/regularizations', { dateYMD: date, checkIn: checkIn || null, checkOut: checkOut || null, reason }),
    onSuccess: () => {
      toast.success('Correction requested — leadership will review it');
      qc.invalidateQueries({ queryKey: ['regularizations'] });
      setOpen(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not submit the request'),
  });

  const submit = () => {
    if (!checkIn && !checkOut) return toast.error('Enter a check-in and/or check-out time');
    if (checkIn && checkOut && checkOut <= checkIn) return toast.error('Check-out time must be after check-in');
    if (reason.trim().length < 3) return toast.error('Add a short reason');
    return mut.mutate();
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        trigger ?? (
          <Button variant="outline" size="sm">
            <Wrench className="size-4" /> Request correction
          </Button>
        )
      }
      title="Request attendance correction"
      description="Forgot to check in/out, or wrong time? Ask leadership to fix it."
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending}>
            {mut.isPending ? 'Submitting…' : 'Submit'}
          </Button>
        </>
      }
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto py-2">
        <div className="space-y-1.5">
          <Label htmlFor="r-date">Date</Label>
          <DatePicker id="r-date" value={date} min={APP_LIVE_YMD} max={todayYMD()} onChange={setDate} className="bg-background/50" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="r-in">Check-in time</Label>
            <TimePicker id="r-in" value={checkIn} onChange={setCheckIn} className="bg-background/50" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-out">Check-out time</Label>
            <TimePicker id="r-out" value={checkOut} onChange={setCheckOut} className="bg-background/50" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Leave a time blank if it’s already correct.</p>
        <div className="space-y-1.5">
          <Label htmlFor="r-reason">Reason</Label>
          <Textarea id="r-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Forgot to check out — left at 18:00" className="bg-background/50" />
        </div>
      </div>
    </AppDialog>
  );
}
