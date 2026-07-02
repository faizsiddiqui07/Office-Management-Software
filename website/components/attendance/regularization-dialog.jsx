'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { todayYMD } from '@/lib/time';

export function RegularizationDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState(todayYMD());
  const [checkIn, setCheckIn] = React.useState('');
  const [checkOut, setCheckOut] = React.useState('');
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setDate(todayYMD());
    setCheckIn('');
    setCheckOut('');
    setReason('');
  }, [open]);

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
        <Button variant="outline" size="sm">
          <Wrench className="size-4" /> Request correction
        </Button>
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
          <Input id="r-date" type="date" value={date} max={todayYMD()} onChange={(e) => setDate(e.target.value)} className="bg-background/50" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="r-in">Check-in time</Label>
            <Input id="r-in" type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="bg-background/50" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-out">Check-out time</Label>
            <Input id="r-out" type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="bg-background/50" />
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
