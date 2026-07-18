'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Check, Clock, LogIn, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatTime, formatDuration } from '@/lib/time';
import { useAttendanceToday, fmtCountdown } from './use-attendance-today';
import { LATE_REASONS } from './check-in-card';

/**
 * The Dashboard's attendance button. It marks attendance right here instead of
 * sending people to the Attendance page, and follows exactly the same rules as the
 * big card — they share `useAttendanceToday`, so the late-reason prompt, the
 * post-check-in cool-down and the check-out confirmation all behave identically and
 * either screen reflects the other straight away.
 */
export function QuickAttendanceAction() {
  const {
    record,
    checkedIn,
    checkedOut,
    elapsedMin,
    cooldownLeftMs,
    inCooldown,
    wouldBeLate,
    checkInMut,
    checkOutMut,
  } = useAttendanceToday();

  const [lateOpen, setLateOpen] = React.useState(false);
  const [lateCategory, setLateCategory] = React.useState('');
  const [lateNote, setLateNote] = React.useState('');
  const [confirmOut, setConfirmOut] = React.useState(false);
  const [canConfirm, setCanConfirm] = React.useState(false);

  // Arm the confirm a beat after it opens so a frantic double-tap can't sail through.
  React.useEffect(() => {
    if (!confirmOut) {
      setCanConfirm(false);
      return undefined;
    }
    const t = setTimeout(() => setCanConfirm(true), 800);
    return () => clearTimeout(t);
  }, [confirmOut]);

  const base = 'inline-flex min-h-10 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium ring-1 transition-colors';

  const onCheckIn = () => {
    if (wouldBeLate) setLateOpen(true);
    else checkInMut.mutate(undefined);
  };
  const submitLate = () => {
    const reason = lateCategory || lateNote.trim() ? { category: lateCategory, note: lateNote.trim() } : undefined;
    setLateOpen(false);
    checkInMut.mutate(reason, {
      onSuccess: () => {
        setLateCategory('');
        setLateNote('');
      },
    });
  };

  let control;
  if (checkedOut) {
    control = (
      <span className={cn(base, 'bg-success/12 text-success ring-success/25')}>
        <Check className="size-4" /> Done at {formatTime(record.checkOutAt)}
      </span>
    );
  } else if (!checkedIn) {
    control = (
      <button type="button" onClick={onCheckIn} disabled={checkInMut.isPending} className={cn(base, 'bg-primary text-primary-foreground ring-primary/30 hover:bg-primary/90 disabled:opacity-70')}>
        <LogIn className="size-4" /> {checkInMut.isPending ? 'Checking in…' : 'Check in'}
      </button>
    );
  } else if (inCooldown) {
    control = (
      <span className={cn(base, 'cursor-not-allowed bg-muted/40 text-muted-foreground ring-border')} title="Locked briefly so a double-tap can't check you out by mistake">
        <Clock className="size-4" /> Check out in <span className="tabular-nums">{fmtCountdown(cooldownLeftMs)}</span>
      </span>
    );
  } else {
    control = (
      <button type="button" onClick={() => setConfirmOut(true)} disabled={checkOutMut.isPending} className={cn(base, 'glass ring-border hover:bg-muted/40 disabled:opacity-70')}>
        <LogOut className="size-4" /> {checkOutMut.isPending ? 'Checking out…' : 'Check out'}
      </button>
    );
  }

  return (
    <>
      {control}

      <AppDialog
        open={lateOpen}
        onOpenChange={setLateOpen}
        title="You're checking in late"
        description="Add a quick reason so your team has the context — totally optional."
        footer={
          <>
            <Button variant="outline" onClick={() => setLateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitLate} disabled={checkInMut.isPending}>
              {checkInMut.isPending ? 'Checking in…' : 'Check in'}
            </Button>
          </>
        }
      >
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="qa-late-cat">Reason</Label>
            <Select value={lateCategory} onValueChange={setLateCategory}>
              <SelectTrigger id="qa-late-cat" className="w-full bg-background/50">
                <SelectValue placeholder="Select a reason (optional)" />
              </SelectTrigger>
              <SelectContent>
                {LATE_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qa-late-note">Note (optional)</Label>
            <Textarea
              id="qa-late-note"
              value={lateNote}
              onChange={(e) => setLateNote(e.target.value)}
              placeholder="e.g. Morning site visit at the client location"
              className="min-h-20 bg-background/50"
            />
          </div>
        </div>
      </AppDialog>

      <AppDialog
        open={confirmOut}
        onOpenChange={setConfirmOut}
        title="Check out for the day?"
        description="You can’t undo this yourself — your manager would have to correct it."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOut(false)}>
              Not yet
            </Button>
            <Button
              onClick={() => {
                setConfirmOut(false);
                checkOutMut.mutate();
              }}
              disabled={!canConfirm || checkOutMut.isPending}
            >
              <LogOut className="size-4" />
              {checkOutMut.isPending ? 'Checking out…' : canConfirm ? 'Yes, check out' : 'Please wait…'}
            </Button>
          </>
        }
      >
        <p className="py-2 text-sm text-muted-foreground">
          Checked in at <span className="font-medium text-foreground">{checkedIn ? formatTime(record.checkInAt) : '—'}</span> ·
          worked <span className="font-medium text-foreground">{formatDuration(elapsedMin)}</span> so far.
        </p>
      </AppDialog>
    </>
  );
}
