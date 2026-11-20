'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Check, Clock, Home, LogIn, LogOut } from 'lucide-react';
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
    isWFH,
    elapsedMin,
    overtimeMin,
    cooldownMin,
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

  /*
   * POORI CHAUDAI KA EK BUTTON, CHAAR HAALAT (owner ka faisla, 20 Nov 2026).
   *
   * Pehle ye content jitna chauda tha aur dashboard par paanch doosre button ke beech
   * baithta tha. Ab wo saare button hat chuke hain (19 Nov) — yahi akela kaam hai jo
   * sirf isi screen par ho sakta hai, isliye poori chaudai iski hai.
   *
   * Chaar haalat, ek hi jagah:
   *   1. hazri se pehle  → "Check in"
   *   2. check-in ke baad → 30 minute ka block, ulti ginti + patli lakeer
   *   3. block ke baad    → "Check out", saath me kab aaye aur kitna kaam hua
   *   4. check-out ke baad → kitna kaam hua aur kitna overtime
   *
   * 30 MINUTE KA BLOCK NAYA NAHI HAI — `checkOutCooldownMinutes` pehle se 30 hai aur
   * Settings se badla ja sakta hai. Pehle wo ek chhoti si line me chhupa hua tha; ab
   * ginti bhi dikhti hai aur wajah bhi likhi hai.
   */
  // Phone par POORI chaudai (owner ne yahi maanga). Laptop par ek thehri hui chaudai —
  // 1440px par poori chaudai ka button 1110px ka ho jaata tha, jo ek lambi patli patti
  // jaisa lagta hai, button jaisa nahi (naap kar dekha).
  const base = 'flex w-full min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ring-1 transition-colors sm:max-w-sm';
  // Block kitna beet chuka — patli lakeer isi par bharti hai.
  const cooldownDone = cooldownMin > 0
    ? Math.min(100, Math.max(0, 100 - (cooldownLeftMs / (cooldownMin * 60000)) * 100))
    : 100;

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
  if (isWFH) {
    // Nothing to clock on a work-from-home day — the attendance is already recorded.
    control = (
      <span className={cn(base, 'bg-primary/12 text-primary ring-primary/25')}>
        <Home className="size-4 shrink-0" /> Working from home
      </span>
    );
  } else if (checkedOut) {
    // Din khatam. Ab is jagah ka ek hi kaam hai: aaj kitna kaam hua, aur kitna overtime.
    // "Done at 18:30" akela ye nahi batata tha, aur wahi sabse pehla sawaal hota hai.
    control = (
      <div className={cn(base, 'flex-col gap-1 bg-success/10 text-success ring-success/25')}>
        <span className="flex items-center gap-2 font-semibold">
          <Check className="size-4 shrink-0" />
          Worked {formatDuration(elapsedMin)}
          {overtimeMin > 0 ? <span className="text-primary">· OT {formatDuration(overtimeMin)}</span> : null}
        </span>
        <span className="text-xs font-normal text-muted-foreground">
          {formatTime(record.checkInAt)} – {formatTime(record.checkOutAt)}
        </span>
      </div>
    );
  } else if (!checkedIn) {
    control = (
      <button type="button" onClick={onCheckIn} disabled={checkInMut.isPending} className={cn(base, 'bg-primary text-base text-primary-foreground ring-primary/30 hover:bg-primary/90 disabled:opacity-70')}>
        <LogIn className="size-4 shrink-0" /> {checkInMut.isPending ? 'Checking in…' : 'Check in'}
      </button>
    );
  } else if (inCooldown) {
    // Block ke do hisse: ulti ginti (kitna baaki) aur patli lakeer (kitna beet gaya).
    // Sirf ginti dene par wo rukà hua lagta hai; lakeer se dikhta hai ki chal raha hai.
    control = (
      <div className={cn(base, 'flex-col gap-1.5 bg-muted/40 text-muted-foreground ring-border')}>
        <span className="flex items-center gap-2">
          <Clock className="size-4 shrink-0" />
          Check out in <span className="font-semibold tabular-nums text-foreground">{fmtCountdown(cooldownLeftMs)}</span>
        </span>
        <span className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
          <span className="block h-full rounded-full bg-primary/60 transition-[width] duration-1000 ease-linear" style={{ width: `${cooldownDone}%` }} />
        </span>
        <span className="text-xs">
          Checked in {formatTime(record.checkInAt)} · locked for {cooldownMin} min
        </span>
      </div>
    );
  } else {
    control = (
      <button type="button" onClick={() => setConfirmOut(true)} disabled={checkOutMut.isPending} className={cn(base, 'glass flex-col gap-0.5 ring-border hover:bg-muted/40 disabled:opacity-70')}>
        <span className="flex items-center gap-2 text-base">
          <LogOut className="size-4 shrink-0" /> {checkOutMut.isPending ? 'Checking out…' : 'Check out'}
        </span>
        <span className="text-xs font-normal text-muted-foreground">
          In at {formatTime(record.checkInAt)} · worked {formatDuration(elapsedMin)}
        </span>
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
