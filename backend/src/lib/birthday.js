/**
 * A person's birthday is a non-working day FOR THEM ALONE.
 *
 * A company holiday closes the office for everybody and lives in the Holiday collection
 * (holidayYMDSet). A birthday is personal: the office is open, everyone else is working,
 * and only the one person is free to stay home. So it can't go through the company holiday
 * set — every working-day decision has to ask "is this THIS user's birthday?" separately,
 * which is what these helpers are for.
 *
 * Office rule (owner, 2026-08-24): the day costs them nothing at all — no absence, no
 * penalty, no broken punctual streak, no spoiled perfect month, nothing off the leave
 * quota, and it is not counted in the working days a report measures them against. If they
 * DO come in, attendance is recorded as normal and is never late.
 *
 * The match is on MONTH AND DAY, ignoring the birth year — deliberately identical to
 * attendance.service's isOffDayFor, so the day someone can't be "late" on and the day they
 * can't be "absent" on are always the same day. (A 29 February birthday therefore simply
 * doesn't fall in a common year, matching that same rule.)
 */

/** Is `ymd` this user's birthday? Safe on a user with no date of birth (returns false). */
export function isBirthdayYMD(user, ymd) {
  const dob = user?.dateOfBirth || '';
  if (dob.length < 10 || !ymd || ymd.length < 10) return false;
  return dob.slice(5, 10) === ymd.slice(5, 10);
}

/**
 * The set of days in [fromYMD, toYMD] that are this user's birthday — usually empty or a
 * single day, but a range spanning more than a year can hold several. Built by walking the
 * years in the window rather than the days, so a multi-year report costs nothing.
 */
export function birthdayYMDSet(user, fromYMD, toYMD) {
  const set = new Set();
  const dob = user?.dateOfBirth || '';
  if (dob.length < 10 || !fromYMD || !toYMD || fromYMD > toYMD) return set;
  const mmdd = dob.slice(5, 10);
  const firstYear = Number(fromYMD.slice(0, 4));
  const lastYear = Number(toYMD.slice(0, 4));
  if (!Number.isFinite(firstYear) || !Number.isFinite(lastYear)) return set;
  for (let y = firstYear; y <= lastYear; y += 1) {
    const ymd = `${y}-${mmdd}`;
    if (ymd >= fromYMD && ymd <= toYMD) set.add(ymd);
  }
  return set;
}

/**
 * "Is this a day off for this person?" — the company holiday set (already loaded for the
 * window) OR their own birthday. The one place callers should ask, so no site forgets the
 * birthday half.
 */
export function isNonWorkingFor(user, ymd, companyHolidaySet) {
  return (companyHolidaySet && companyHolidaySet.has(ymd)) || isBirthdayYMD(user, ymd);
}
