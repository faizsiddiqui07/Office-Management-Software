import { ymdInTz } from './time.js';

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
 * — their joining day when they arrived mid-period, otherwise the period's own start.
 */
export function periodStartFor(user, fromYMD) {
  const from = joinedYMD(user);
  return from && from > fromYMD ? from : fromYMD;
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
