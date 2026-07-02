'use client';

import { StatusBadge, STATUS_TONES } from '@/components/glass/status-badge';
import { effectiveStatus, attendanceStatusLabel } from '@/lib/attendance';

/**
 * The one way attendance status renders app-wide. A late arrival still ATTENDED,
 * so it shows as a green "Present" badge with a small "(late)" indicator beside
 * it — never as a scary standalone "Late" status. Excused lates stay "On duty".
 */
export function AttendanceStatusBadge({ attendance, fallback }) {
  const s = effectiveStatus(attendance, fallback);
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
  const s = effectiveStatus(attendance, fallback);
  return s === 'LATE' ? 'Present (late)' : attendanceStatusLabel(s);
}
