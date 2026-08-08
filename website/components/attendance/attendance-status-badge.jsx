'use client';

import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { effectiveStatus, attendanceStatusLabel, halfDayChips } from '@/lib/attendance';

/**
 * The one way attendance status renders app-wide. A late arrival still ATTENDED,
 * so it shows as a green "Present" badge with a small "(late)" indicator beside
 * it — never as a scary standalone "Late" status. Excused lates stay "On duty".
 * A half-day leave shows BOTH halves in order (Half day + Present / vice-versa).
 */
export function AttendanceStatusBadge({ attendance, fallback }) {
  const halves = halfDayChips(attendance);
  if (halves) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {halves.map((h, i) => <StatusBadge key={i} tone={h.tone}>{h.label}</StatusBadge>)}
      </span>
    );
  }
  const s = effectiveStatus(attendance, fallback);
  // Awaited = office day still running, not in yet → a quiet dash, never "Absent".
  if (s === 'AWAITED') return <span className="text-sm text-muted-foreground">—</span>;
  if (s === 'LATE') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <StatusBadge tone="success">Present</StatusBadge>
        <span className="text-[11px] font-medium text-amber-600 dark:text-amber-300">(late)</span>
      </span>
    );
  }
  return <StatusBadge tone={STATUS_TONES[s] ?? 'neutral'}>{attendanceStatusLabel(s)}</StatusBadge>;
}

/** Search/sort text matching what AttendanceStatusBadge displays. */
export function attendanceStatusText(attendance, fallback) {
  const halves = halfDayChips(attendance);
  if (halves) return halves.map((h) => h.label).join(' ');
  const s = effectiveStatus(attendance, fallback);
  return s === 'LATE' ? 'Present (late)' : attendanceStatusLabel(s);
}
