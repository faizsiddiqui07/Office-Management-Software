import { notify } from '../models/Notification.js';
import { COMPANY_TZ } from './time.js';

/**
 * "Leadership ne MERE record me kuch badla" — ek hi jagah se khabar.
 *
 * Kyun (owner ka faisla, 19 Nov 2026, idea I51): attendance, users aur points ki service me
 * ek bhi notification nahi thi. Kisi ka check-out 18:40 se 18:00 kar do, din clear kar do,
 * leave quota 18 se 16 kar do, ya +5 points de do — us bande ko pata hi nahi chalta tha.
 * Use tab pata chalta jab wo khud dhoondhe, aur mahine ke end me 40 minute ka overtime
 * chupchaap gayab milta. Bharosa yahin toot-ta hai.
 *
 * TEEN NIYAM jo har jagah lagte hain, isliye yahan hain aur call sites par nahi:
 *  1. Apne hi kiye badlav par khabar NAHI (actor === subject).
 *  2. Jab sach me kuch na badla ho to khabar NAHI — `changes` khaali hui to kuch nahi
 *     jaata. Dialog ka "Save" dobara dabane se ping nahi aani chahiye.
 *  3. Khabar kabhi us kaam ko nahi todti jiske baad wo bheji gayi. notify() khud apni
 *     galti nigal leta hai, par yahan text banate waqt bhi kuch toot sakta hai — aur ek
 *     notification ki wajah se theek ho chuka attendance edit 500 nahi dena chahiye.
 *
 * AWAIT karna zaroori hai (call sites par bhi, route handler tak): Lambda handler ke
 * laut-te hi container JAM ho jaata hai, aur adhoori padi promise wahin ruk jaati hai —
 * models/Notification.js me ye poora kissa likha hai. Isliye yahan `await notify(...)`.
 *
 * Kahan se KABHI nahi bulana: koi bhi dobara-hisab karne wala engine —
 * reconcileLatePenalty / reconcileAbsence / reconcilePerfectMonth / markStreaksStale /
 * restampOffDay / recomputeAllOvertime / backfillMonth / runRebuild / scanAbsences /
 * scheduler tick. Ek holiday declare karne ya Settings save karne par wo saikdon row
 * dobara likhte hain — wahan se bulaya to poore office ke phone ek saath baj uthenge.
 * Sirf us raaste par lagao jahan ek INSAAN ne ek badlav kiya ho.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'HH:mm' in company time, or '—' when there is no time at all. */
export function hm(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  // Intl, not date-fns-tz: this file is imported by the hot attendance path and the
  // formatter is all we need here.
  return new Intl.DateTimeFormat('en-GB', { timeZone: COMPANY_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** '2026-11' → 'Nov 2026'. Anything else comes back as it is (never throws). */
export function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return String(ym || '');
  const idx = Number(m[2]) - 1;
  return MONTHS[idx] ? `${MONTHS[idx]} ${m[1]}` : String(ym);
}

/** '2026-07-01' → '1 Jul 2026'. Needs the year: a joining date is often years back. */
export function dateLabel(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return String(ymd || '');
  const idx = Number(m[2]) - 1;
  return MONTHS[idx] ? `${Number(m[3])} ${MONTHS[idx]} ${m[1]}` : String(ymd);
}

/** [1,2,3,4,5] → 'Mon, Tue, Wed, Thu, Fri'. Empty = whatever the office runs. */
export function workDaysLabel(days) {
  if (!Array.isArray(days) || !days.length) return 'office default';
  return days
    .map(Number)
    .filter((d) => d >= 0 && d <= 6)
    .sort((a, b) => a - b)
    .map((d) => DAYS[d])
    .join(', ');
}

/** `was → now`, but only when they differ. Returns '' so callers can .filter(Boolean). */
export function changed(label, was, now) {
  const a = was === null || was === undefined || was === '' ? '—' : String(was);
  const b = now === null || now === undefined || now === '' ? '—' : String(now);
  return a === b ? '' : `${label} ${a} → ${b}`;
}

/**
 * Tell `subject` that somebody changed their record. Returns true if a notification
 * actually went out, so a test can assert the "nothing was sent" cases too.
 *
 * @param {object}   o
 * @param {object|string} o.subject  whose record changed (User doc or id)
 * @param {object}   o.actor         who changed it (User doc; its `name` is quoted)
 * @param {string}   o.type          notification type (ATTENDANCE_CHANGED, POINTS_CHANGED, …)
 * @param {string}   o.title         short — this is the phone's banner line
 * @param {string}   o.lead          the sentence: "Your 6 Nov attendance was changed"
 * @param {string[]} o.changes       the detail: ['check-out 18:40 → 18:00']; empty ⇒ nothing sent
 * @param {string}   o.link          a page the SUBJECT can open (not an approver-only page)
 * @param {string}   [o.entityType]  with entityId, makes the phone REPLACE an earlier
 *                                   notification about the same thing instead of stacking
 * @param {any}      [o.entityId]
 */
export async function alertRecordChange({ subject, actor, type, title, lead, changes = [], link, entityType = '', entityId = null }) {
  try {
    const subjectId = subject?._id ?? subject;
    if (!subjectId) return false;
    const actorId = actor?._id ?? actor;
    // Niyam 1: apne hi kiye badlav par apne hi phone par ping bekaar hai.
    if (actorId && String(subjectId) === String(actorId)) return false;
    const list = changes.filter(Boolean);
    // Niyam 2: kuch nahi badla to kuch nahi bhejna.
    if (!list.length) return false;
    const by = actor?.name ? ` · by ${actor.name}` : '';
    await notify({
      user: subjectId,
      type,
      title,
      message: `${lead} — ${list.join(', ')}${by}`,
      link,
      entityType,
      entityId,
    });
    return true;
  } catch (err) {
    // Niyam 3: badlav ho chuka hai; uske baad ki khabar fail hone par kaam nahi girta.
    console.error('record-change alert failed:', err?.message);
    return false;
  }
}
