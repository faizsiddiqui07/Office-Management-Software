'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';

/** Resolve the device's current GPS position, or reject with a friendly message. */
export function getPosition() {
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

/** "28:14" / "1:05:09" — the live count-down until check-out unlocks. */
export function fmtCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Everything the check-in / check-out controls need, in one place: today's record,
 * the two mutations (with GPS when the office has geo-fencing on), and the derived
 * state — elapsed time, overtime, whether this check-in counts as late, and the
 * post-check-in cool-down that keeps a double-tap from checking someone straight
 * back out.
 *
 * Both the Attendance page card and the Dashboard quick action use this, so the
 * rules only ever live here. They share the same query key, so acting in one place
 * updates the other immediately.
 */
export function useAttendanceToday() {
  const qc = useQueryClient();
  const [now, setNow] = React.useState(() => Date.now());

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
  const checkedIn = !!record?.checkInAt;
  const checkedOut = !!record?.checkOutAt;
  const workEndAt = data?.workEndAt ? new Date(data.workEndAt).getTime() : null;

  let elapsedMin = 0;
  let overtimeMin = 0;
  if (checkedIn && !checkedOut) {
    elapsedMin = (now - new Date(record.checkInAt).getTime()) / 60000;
    overtimeMin = workEndAt ? Math.max(0, (now - workEndAt) / 60000) : 0;
  } else if (checkedOut) {
    elapsedMin = record.workedMinutes;
    overtimeMin = record.overtimeMinutes;
  }

  // Check-out stays locked for a while after check-in (minutes set in Settings), so a
  // slow phone can't turn a second tap into an instant check-out.
  const cooldownMin = data?.settings?.checkOutCooldownMinutes ?? 30;
  const cooldownLeftMs =
    checkedIn && !checkedOut && cooldownMin > 0
      ? new Date(record.checkInAt).getTime() + cooldownMin * 60000 - now
      : 0;
  const inCooldown = cooldownLeftMs > 0;

  // Would checking in right now be late? → the caller asks for an optional reason.
  const lateThreshold = data?.workStartAt
    ? new Date(data.workStartAt).getTime() + (data.settings?.graceMinutes || 0) * 60000
    : null;
  const wouldBeLate = !checkedIn && lateThreshold != null && now > lateThreshold;

  return {
    data,
    isLoading,
    now,
    record,
    checkedIn,
    checkedOut,
    elapsedMin,
    overtimeMin,
    cooldownMin,
    cooldownLeftMs,
    inCooldown,
    wouldBeLate,
    checkInMut,
    checkOutMut,
  };
}
