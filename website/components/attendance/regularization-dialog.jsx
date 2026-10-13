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
 * Attendance-correction request dialog — nayi request, aur PENDING request ka edit bhi.
 *
 * Bina props ke ye sirf "Request correction" wala button hai. Teen aur tareeke:
 *   • `prefill` + `trigger` — kisi khaas din se seed karke (jaise history ka ek-tap "Fix")
 *   • `editing` — ek maujooda PENDING request; tab form usi se bharta hai aur POST ki
 *     jagah PUT jaata hai
 *   • `open` + `onOpenChange` — bahar se khola/band kiya jaye (edit isi se chalta hai,
 *     kyunki wo detail dialog ke footer se shuru hota hai, kisi trigger se nahi)
 *
 * Edit sirf PENDING tak milta hai, aur ye rok SERVER par hai (regularization.service.js) —
 * yahan ka UI bas use dikhata hai. Decide hote hi attendance, late ki penalty, overtime
 * sab badal chuke hote hain; uske baad request badalna matlab record aur request ka ek
 * doosre se alag ho jana.
 */
export function RegularizationDialog({
  prefill = null,
  trigger = null,
  editing = null,
  open: openProp,
  onOpenChange,
} = {}) {
  const qc = useQueryClient();
  const [openState, setOpenState] = React.useState(false);
  // Bahar se chalaya ja raha hai ya apne aap — dono chalte hain.
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = React.useCallback(
    (v) => (controlled ? onOpenChange?.(v) : setOpenState(v)),
    [controlled, onOpenChange],
  );

  const isEdit = !!editing?.id;

  const [date, setDate] = React.useState(todayYMD());
  const [checkIn, setCheckIn] = React.useState('');
  const [checkOut, setCheckOut] = React.useState('');
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    // Khulte hi dobara seed: edit ho to usi request se, warna prefill se, warna khali.
    setDate(editing?.dateYMD || prefill?.dateYMD || todayYMD());
    setCheckIn(editing?.requestedCheckIn || prefill?.checkIn || '');
    setCheckOut(editing?.requestedCheckOut || prefill?.checkOut || '');
    setReason(editing?.reason || prefill?.reason || '');
    // prefill/editing har render par naye object hote hain; unki fields par depend karo,
    // identity par nahi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id, editing?.dateYMD, editing?.requestedCheckIn, editing?.requestedCheckOut, editing?.reason,
      prefill?.dateYMD, prefill?.checkIn, prefill?.checkOut, prefill?.reason]);

  const mut = useMutation({
    mutationFn: () => {
      const body = { dateYMD: date, checkIn: checkIn || null, checkOut: checkOut || null, reason };
      return isEdit ? api.put(`/regularizations/${editing.id}`, body) : api.post('/regularizations', body);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Correction updated' : 'Correction requested — leadership will review it');
      qc.invalidateQueries({ queryKey: ['regularizations'] });
      setOpen(false);
    },
    onError: (e) => toast.error(e?.message || (isEdit ? 'Could not update the request' : 'Could not submit the request')),
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
        controlled
          ? null
          : trigger ?? (
            <Button variant="outline" size="sm">
              <Wrench className="size-4" /> Request correction
            </Button>
          )
      }
      title={isEdit ? 'Edit correction request' : 'Request attendance correction'}
      description={
        isEdit
          ? 'Still waiting to be reviewed, so you can change it.'
          : 'Forgot to check in/out, or wrong time? Ask leadership to fix it.'
      }
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending}>
            {mut.isPending ? (isEdit ? 'Saving…' : 'Submitting…') : (isEdit ? 'Save changes' : 'Submit')}
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
