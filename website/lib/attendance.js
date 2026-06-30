/**
 * Display status for an attendance record. An excused (leadership-approved) late
 * is shown as "On-duty" — it was real office work (e.g. a site visit), so it
 * must NOT read as "Late" anywhere the employee or team sees it.
 *
 * @param {object|null} att      attendance record (may have status + excused)
 * @param {string} [fallback]    status to use when there's no record (e.g. ABSENT)
 */
export function effectiveStatus(att, fallback) {
  const s = att?.status ?? fallback;
  if (s === 'LATE' && att?.excused) return 'ON_DUTY';
  return s;
}

/** Human label for an attendance status. */
export function attendanceStatusLabel(status) {
  if (status === 'ON_DUTY') return 'On duty';
  return (status || '').replace('_', ' ');
}
