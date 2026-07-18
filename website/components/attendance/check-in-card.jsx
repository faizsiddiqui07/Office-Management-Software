'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, LogIn, LogOut, MapPin, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
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

/** "28:14" / "1:05:09" — the live count-down until check-out unlocks. */
function fmtCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Resolve the device's current GPS position, or reject with a friendly message. */
function getPosition() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Location is not available on this device/browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) =>
        reject(new Error(err?.code === 1 ? 'Please allow location access to mark attendance' : 'Could not get your location — try again')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

export function CheckInCard() {
  const qc = useQueryClient();
  const [now, setNow] = React.useState(() => Date.now());
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

  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: () => api.get('/attendance/today'),
    refetchOnWindowFocus: true,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['attendance'] });

  const checkInMut = useMutation({
    mutationFn: async (lateReason) => {
      const coords = data?.gps?.enabled ? await getPosition() : null;
      const body = { ...(coords || {}), ...(lateReason ? { lateReason } : {}) };
      return api.post('/attendance/check-in', body);
    },
    onSuccess: () => {
      toast.success('Checked in — have a great day!');
      setLateCategory('');
      setLateNote('');
      invalidate();
    },
    onError: (e) => toast.error(e?.message || 'Could not check in'),
  });

  const checkOutMut = useMutation({
    mutationFn: async () => {
      const body = data?.gps?.enabled ? await getPosition() : undefined;
      return api.post('/attendance/check-out', body);
    },
    onSuccess: () => {
      toast.success('Checked out — see you tomorrow!');
      invalidate();
    },
    onError: (e) => toast.error(e?.message || 'Could not check out'),
  });

  const record = data?.record;
  const workEndAt = data?.workEndAt ? new Date(data.workEndAt).getTime() : null;
  const checkedIn = !!record?.checkInAt;
  const checkedOut = !!record?.checkOutAt;

  let elapsedMin = 0;
  let overtimeMin = 0;
  if (checkedIn && !checkedOut) {
    elapsedMin = (now - new Date(record.checkInAt).getTime()) / 60000;
    overtimeMin = workEndAt ? Math.max(0, (now - workEndAt) / 60000) : 0;
  } else if (checkedOut) {
    elapsedMin = record.workedMinutes;
    overtimeMin = record.overtimeMinutes;
  }

  const status = effectiveStatus(record);

  // Check-out stays locked for a short while after check-in (leadership sets the
  // minutes in Settings). This is what stops the classic mishap: on a slow phone the
  // check-in takes a few seconds, the person thinks it didn't work, taps again — and
  // by then the very same button says "Check out".
  const cooldownMin = data?.settings?.checkOutCooldownMinutes ?? 30;
  const cooldownLeftMs =
    checkedIn && !checkedOut && cooldownMin > 0
      ? new Date(record.checkInAt).getTime() + cooldownMin * 60000 - now
      : 0;
  const inCooldown = cooldownLeftMs > 0;

  // Would this check-in (right now) be late? → ask for an optional reason first.
  const lateThreshold = data?.workStartAt
    ? new Date(data.workStartAt).getTime() + (data.settings?.graceMinutes || 0) * 60000
    : null;
  const wouldBeLate = !checkedIn && lateThreshold != null && now > lateThreshold;

  const onCheckIn = () => {
    if (wouldBeLate) setLateOpen(true);
    else checkInMut.mutate(undefined);
  };
  const submitLate = () => {
    const reason = lateCategory || lateNote.trim() ? { category: lateCategory, note: lateNote.trim() } : undefined;
    setLateOpen(false);
    checkInMut.mutate(reason);
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
