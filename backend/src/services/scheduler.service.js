import { maybeRunDaily } from './bonus.service.js';
import { maybeAnnounceBirthdays } from './holiday.service.js';
import { publishDueAnnouncements, announceRecurring } from './announcement.service.js';
import { maybeRunDayCloseDigest } from './dayDigest.service.js';
import { pruneOldChats } from './chat.service.js';
import { runSetupTasks } from '../app.js';

/**
 * Every time-based job, run from the EventBridge schedule (see src/lambda.js) instead of
 * piggy-backing on whoever happens to open the app.
 *
 * Each job is already throttled to once a day (or is a cheap "is anything due?" query),
 * so firing this every few minutes is safe — and those frequent invocations double as a
 * KEEP-WARM: they hold a Lambda container (with its DB connection + role cache already
 * initialised) alive, so the first person to open the app hits a warm function and it
 * loads instantly instead of paying a cold start.
 *
 * Best-effort throughout: one failing job must never stop the others, and the schedule
 * must never error out.
 */
export async function runScheduledJobs() {
  const jobs = { setup: 'ok', bonus: 'ok', birthdays: 'ok', announcements: 'ok', recurring: 'ok', dayDigest: 'ok', chatPrune: 'ok' };
  const tickNow = new Date();
  const settled = await Promise.allSettled([
    // Seed/migration/repair maintenance (system roles, role migrations, admin-lockout
    // failsafe, default holidays). Moved here OFF the request path: running these inside
    // every cold container's first request added ~seconds of DB round-trips to whichever
    // page-load landed on it.
    runSetupTasks(),
    maybeRunDaily(),
    maybeAnnounceBirthdays(),
    // Both announcement jobs get the SAME instant. Called bare they each read their own
    // clock, milliseconds apart, and the two reason about each other's work — one publishes
    // a post whose day the other then has to judge. One tick, one "now", so a day boundary
    // can never fall between them.
    publishDueAnnouncements(tickNow),
    // Repeating announcements going out again today. Cheap when nothing is due, and the
    // every-few-minutes cadence is what lets "at 09:00" land within minutes of 09:00.
    announceRecurring(tickNow),
    maybeRunDayCloseDigest(),
    // Purani chat hatana — sirf tab jab owner ne retention chaalu kiya ho. Band haalat
    // me ye ek Setting padh kar wapas aa jaata hai, isliye har tick par bhi sasta hai.
    pruneOldChats(),
  ]);
  const keys = ['setup', 'bonus', 'birthdays', 'announcements', 'recurring', 'dayDigest', 'chatPrune'];
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      jobs[keys[i]] = r.reason?.message || 'error';
      console.error(`scheduled job "${keys[i]}" failed:`, r.reason?.message);
    }
  });
  return jobs;
}
