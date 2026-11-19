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

/**
 * Human label for an attendance status.
 *
 * YE POORA MAP KYUN HAI: pehle yahan sirf chaar khaas haalat likhe the aur baaki
 * sab `status.replace('_',' ')` par chhod diya tha. Us fallback ka nateeja ye tha ki
 * ek hi table me "Present (late)" ke bagal me kaccha "PRESENT" aur "ON LEAVE" chhapta
 * tha — bade akshar, underscore ke saath. Aur jab se "mera attendance" me khaali din
 * bhi aane lage (19 Nov 2026), HOLIDAY / WEEKEND / ABSENT / UPCOMING bhi usi fallback
 * se guzarte, yaani poori table bhari hui hoti kacche enum se.
 *
 * Lafz backend/src/services/report.service.js ke STATUS_LABEL se HU-BA-HU milte hain,
 * kyunki wahi lafz PDF me chhapte hain — screen aur PDF alag bolein, ye nahi chalega.
 */
const LABELS = {
  PRESENT: 'Present',
  LATE: 'Late',
  ON_DUTY: 'On duty',
  ABSENT: 'Absent',
  ON_LEAVE: 'On leave',
  // Worked, from home — spelled out so the bare acronym never reaches a screen, and so
  // the day is findable by typing "work from home" in the searchable tables.
  WFH: 'Work from home',
  HOLIDAY: 'Holiday',
  WEEKEND: 'Weekend',
  BEFORE_JOINING: 'Not employed yet',
  // Their own birthday: a day off for them alone. Named (with the cake) so a blank day on
  // the sheet reads as "it was their birthday", never as an unexplained absence — and so
  // it is distinguishable from a company holiday, which shares its tone.
  BIRTHDAY: 'Birthday 🎂',
  // Din abhi chal raha hai — aaye nahi hain, par shift khatam bhi nahi hui. Dash, "Absent"
  // nahi. (AWAITED purana naam hai, UPCOMING server ka — dono ek hi baat kehte hain.)
  AWAITED: '—',
  UPCOMING: '—',
};

export function attendanceStatusLabel(status) {
  return LABELS[status] ?? (status || '').replace(/_/g, ' ');
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
      // An unexcused late carries the same small "(late)" marker a normal day does.
      // Without it the row read as a clean "Present" while the Late card upstairs
      // counted it — the sheet and its own total disagreed on screen, and the half-day
      // row was the only place that could happen.
      : { label: 'Present', tone: 'success', late: att.status === 'LATE' };
  } else {
    worked = { label: '—', tone: 'neutral' }; // the working half isn't clocked yet
  }
  return att.halfDayPart === 'SECOND' ? [worked, leave] : [leave, worked];
}
