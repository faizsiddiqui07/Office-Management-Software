import { ymdInTz } from './time.js';
import { APP_LIVE_YMD } from './appLive.js';

/**
 * Nobody has a history before the day they were given access.
 *
 * Every list that covers a date or a period used to include every active person, so
 * someone who joined on the 16th showed up as ABSENT for the 1st–15th — days they had
 * no account for. These helpers are the single place that answers "were they here yet?",
 * so every roster, report and export applies the same rule.
 *
 * A person who joined part-way through a period still belongs in it; only the days
 * before they arrived are theirs to be excluded from.
 */

/** The day this person got access, as 'YYYY-MM-DD' in company time. */
export function joinedYMD(user) {
  const d = user?.dateOfJoining;
  return d ? ymdInTz(d) : '';
}

/** Did this person have access on `ymd`? (Unknown joining date → assume always.) */
export function hadAccessOn(user, ymd) {
  const from = joinedYMD(user);
  return !from || from <= ymd;
}

/** Did this person have access at any point in [fromYMD, toYMD]? */
export function overlapsPeriod(user, fromYMD, toYMD) {
  const from = joinedYMD(user);
  return !from || from <= toYMD;
}

/**
 * The start of the stretch of [fromYMD, toYMD] this person is actually accountable for
 * — the LATEST of: the period's own start, their joining day, and the day the office
 * started running on this system.
 *
 * That last one matters for the fiscal year, which opens on 1 April while nothing was
 * recorded until 1 July. Without it, giving somebody their genuine older joining date
 * would make a yearly report mark three months absent for days that were never
 * tracked — punishing them for having been here longer.
 */
export function periodStartFor(user, fromYMD) {
  const from = joinedYMD(user);
  const start = from && from > fromYMD ? from : fromYMD;
  return start < APP_LIVE_YMD ? APP_LIVE_YMD : start;
}

/**
 * Is `ymd` the very first day this person had access — the day the office went live, or
 * their own joining day when that is later?
 *
 * Nobody is marked absent on it (owner's rule, 1 Oct 2026). An account is created part-way
 * through a day, usually with the person sitting there while it is set up, so a missing
 * check-in on it says nothing about whether they came in. Two people were carrying a −10
 * for exactly this: the office's own first day, 1 July 2026, and a joining day the day
 * after. Absence only — the day still counts as a working day everywhere else, so it
 * neither earns a perfect-attendance month nor keeps a punctual run alive.
 */
export function isFirstAccessDay(user, ymd) {
  return !!ymd && ymd === periodStartFor(user, APP_LIVE_YMD);
}

/**
 * Split a roster into the people who belong in a period and the people who joined after
 * it. The second list is meant to be shown, not silently dropped: the UI says "these
 * names aren't here, and here's the date they joined", so a short list never looks like
 * missing data.
 */
export function splitByJoining(users, fromYMD, toYMD) {
  const included = [];
  const joinedLater = [];
  for (const u of users) {
    if (overlapsPeriod(u, fromYMD, toYMD)) included.push(u);
    else joinedLater.push({ id: String(u._id ?? u.id), name: u.name, joinedYMD: joinedYMD(u) });
  }
  return { included, joinedLater };
}
