'use client';

import * as React from 'react';
import { Clock, LogIn, LogOut, MapPin, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAttendanceToday, fmtCountdown } from './use-attendance-today';
import { GlassCard } from '@/components/glass/glass-card';
import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { COMPANY_TZ, formatClock, formatFullDate, formatTime, formatDuration } from '@/lib/time';
import { effectiveStatus, attendanceStatusLabel } from '@/lib/attendance';

export const LATE_REASONS = [
  'Site / Field visit',
  'Client meeting',
  'Traffic / Transport',
  'Medical',
  'Personal',
  'Other',
];

export function CheckInCard() {
  const {
    data,
    isLoading,
    now,
    record,
    checkedIn,
    checkedOut,
    elapsedMin,
    overtimeMin,
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
  // The confirm button arms a moment after the dialog opens, so a frantic double-tap
  // can't blow straight through it — the whole point is to stop accidental check-outs.
  const [canConfirm, setCanConfirm] = React.useState(false);

  React.useEffect(() => {
    if (!confirmOut) {
      setCanConfirm(false);
      return undefined;
    }
    const t = setTimeout(() => setCanConfirm(true), 800);
    return () => clearTimeout(t);
  }, [confirmOut]);

  const status = effectiveStatus(record);

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

  return (
    <>
      <GlassCard className="p-6 sm:p-8">
        <div className="flex flex-col gap-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">{formatFullDate(now)}</p>
              <p className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
                {formatClock(now)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Company time · {COMPANY_TZ}</p>
            </div>
            {status ? (
              <StatusBadge tone={STATUS_TONES[status] ?? 'neutral'}>{attendanceStatusLabel(status)}</StatusBadge>
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Check-in" value={checkedIn ? formatTime(record.checkInAt) : '—'} />
            <Stat label={checkedOut ? 'Worked' : 'Elapsed'} value={checkedIn ? formatDuration(elapsedMin) : '—'} />
            <Stat label="Overtime" value={checkedIn ? formatDuration(overtimeMin) : '—'} highlight={overtimeMin > 0} />
          </div>

          {data?.gps?.enabled && !checkedOut ? (
            <p className="-mb-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="size-3.5" /> Location required — you must be at the office.
            </p>
          ) : null}

          {!checkedIn ? (
            <Button onClick={onCheckIn} disabled={checkInMut.isPending || isLoading} className="h-12 w-full text-base">
              <LogIn /> {checkInMut.isPending ? 'Checking in…' : 'Check in'}
            </Button>
          ) : !checkedOut ? (
            inCooldown ? (
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2 rounded-2xl bg-success/10 p-3 text-sm font-medium text-success ring-1 ring-success/20">
                  <ShieldCheck className="size-4 shrink-0" />
                  You&apos;re checked in at {formatTime(record.checkInAt)}
                </div>
                <Button disabled variant="outline" className="h-12 w-full text-base">
                  <Clock /> Check out available in{' '}
                  <span className="tabular-nums">{fmtCountdown(cooldownLeftMs)}</span>
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Locked for a few minutes so a double-tap can’t check you out by mistake.
                </p>
              </div>
            ) : (
              <Button
                onClick={() => setConfirmOut(true)}
                disabled={checkOutMut.isPending}
                variant="outline"
                className="h-12 w-full text-base"
              >
                <LogOut /> {checkOutMut.isPending ? 'Checking out…' : 'Check out'}
              </Button>
            )
          ) : (
            <div className="rounded-2xl bg-success/10 p-3 text-center text-sm font-medium text-success ring-1 ring-success/20">
              You&apos;re done for today — checked out at {formatTime(record.checkOutAt)}
            </div>
          )}
        </div>
      </GlassCard>

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
            <Label htmlFor="late-cat">Reason</Label>
            <Select value={lateCategory} onValueChange={setLateCategory}>
              <SelectTrigger id="late-cat" className="w-full bg-background/50">
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
            <Label htmlFor="late-note">Note (optional)</Label>
            <Textarea
              id="late-note"
              value={lateNote}
              onChange={(e) => setLateNote(e.target.value)}
              placeholder="e.g. Morning site visit at the client location"
              className="min-h-20 bg-background/50"
            />
          </div>
          <p className="text-xs text-muted-foreground">Reason is optional — you can just check in. Your manager can mark on-duty lates as excused.</p>
        </div>
      </AppDialog>

      {/* Check-out is a one-way door for the day, so always confirm it. */}
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
        <div className="py-2">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Checked in" value={checkedIn ? formatTime(record.checkInAt) : '—'} />
            <Stat label="Worked so far" value={formatDuration(elapsedMin)} />
          </div>
          {overtimeMin > 0 ? (
            <p className="mt-3 text-center text-sm text-primary">
              Includes {formatDuration(overtimeMin)} overtime — it’s added to your leave balance.
            </p>
          ) : null}
        </div>
      </AppDialog>
    </>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div className="rounded-2xl bg-foreground/[0.04] p-3 text-center ring-1 ring-border/50">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', highlight && 'text-primary')}>{value}</p>
    </div>
  );
}
