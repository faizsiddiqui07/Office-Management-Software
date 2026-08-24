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
  // Worked, from home — spelled out so the bare acronym never reaches a screen, and so
  // the day is findable by typing "work from home" in the searchable tables.
  if (status === 'WFH') return 'Work from home';
  // Not in yet, but their office day isn't over — shown as a neutral dash, not "Absent".
  if (status === 'AWAITED') return '—';
  // Their own birthday: a day off for them alone. Named (with the cake) so a blank day on
  // the sheet reads as "it was their birthday", never as an unexplained absence — and so
  // it is distinguishable from a company holiday, which shares its tone.
  if (status === 'BIRTHDAY') return 'Birthday 🎂';
  return (status || '').replace('_', ' ');
}

/**
 * A half-day leave splits the day in two, shown IN ORDER: the half that's off reads
 * "Half day", the working half reads its real state (Present / On duty / — if not in
 * yet). First-half leave → [Half day, <worked>]; second-half leave → [<worked>, Half day].
 * Returns null when it isn't a half-day, so callers fall back to the single badge.
 */
export function halfDayChips(att) {
  if (!att?.halfDayLeave) return null;
  const leave = { label: 'Half day', tone: 'info' };
  let worked;
  if (att.checkInAt) {
    worked = att.status === 'LATE' && att.excused
      ? { label: 'On duty', tone: 'success' }
      : { label: 'Present', tone: 'success' };
  } else {
    worked = { label: '—', tone: 'neutral' }; // the working half isn't clocked yet
  }
  return att.halfDayPart === 'SECOND' ? [worked, leave] : [leave, worked];
}
