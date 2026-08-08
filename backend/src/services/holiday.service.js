import { Holiday } from '../models/Holiday.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { notify } from '../models/Notification.js';
import { companyDayFromYMD, ymdInTz } from '../lib/time.js';

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/**
 * Once a day, push the team a birthday wish for anyone whose birthday is today.
 *
 * Birthdays only showed as a login popup, so whoever didn't open the app that day never
 * saw it. There's no cron on Lambda, so this rides on the dashboard load (best-effort)
 * and claims the day atomically via a settings flag, so exactly one instance sends —
 * everyone gets the bell AND a phone push (notify() mirrors to Web Push).
 */
export async function maybeAnnounceBirthdays() {
  const today = ymdInTz(new Date());
  const s = await Setting.getSingleton();
  if (s.lastBirthdayPing === today) return;
  // Claim the day — only the instance whose update matches gets to send.
  const claim = await Setting.updateOne({ key: 'global', lastBirthdayPing: { $ne: today } }, { $set: { lastBirthdayPing: today } });
  if (!claim.modifiedCount && !claim.nModified) return;
  Setting.invalidateCache();

  // A birthday is a repeating calendar entry keyed on the date of birth; match the
  // month-and-day, ignoring the birth year. (A 29 Feb birthday simply won't fire in a
  // non-leap year — a rare edge nobody is likely to hit.)
  const mmdd = today.slice(5);
  const birthdays = (await Holiday.find({ type: 'BIRTHDAY' }).select('title startYMD'))
    .filter((h) => (h.startYMD || '').slice(5) === mmdd);
  if (!birthdays.length) return;

  const names = birthdays.map((h) => h.title).filter(Boolean).join(', ');
  if (!names) return;
  const users = await User.find({ isActive: true }).select('_id');
  const message = `It's ${names}'s birthday today — wish ${birthdays.length > 1 ? 'them' : 'them'} a wonderful day! 🎂`;
  for (const u of users) {
    // eslint-disable-next-line no-await-in-loop
    await notify({ user: u._id, type: 'BIRTHDAY', title: 'Happy Birthday! 🎉', message, link: '/calendar' });
  }
}

function enumerateDays(fromYMD, toYMD) {
  const out = [];
  let d = new Date(`${fromYMD}T00:00:00Z`);
  const end = new Date(`${toYMD}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

// ── Yearly repeats ──────────────────────────────────────────
// All of this is deliberately string maths on yyyy-MM-dd. Shifting a recurrence with
// Date.setUTCFullYear turns 29 Feb into 1 March without complaining, and pushing it
// through companyDayFromYMD drags it across a timezone — either one silently paints an
// entry on the wrong day, in a feature whose entire job is landing on the right day.

const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 1-12
const spanDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * The same day-of-year in another year, clamped to a date that exists.
 *
 * 29 February becomes 28 February in a common year rather than rolling into March: the
 * calendar is fetched a month at a time, so rolling would empty February and put an
 * entry in a March nobody created it in. The anchor still holds the real 29th, so a
 * leap year gets it back.
 */
function shiftToYear(ymd, targetYear) {
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  return `${targetYear}-${pad(month)}-${pad(Math.min(day, daysInMonth(targetYear, month)))}`;
}

/**
 * Every time this entry falls inside [fromYMD, toYMD].
 *
 * `notBefore` bounds the maths without bounding the display: pass it the date from
 * which a repeat is allowed to count, and earlier occurrences are dropped.
 */
function occurrencesFor(h, fromYMD, toYMD, { notBefore = '', repeats = null } = {}) {
  const aStart = h.startYMD;
  const aEnd = h.endYMD || h.startYMD;
  const repeatsYearly = repeats === null ? h.repeatsYearly : repeats;

  if (!repeatsYearly) {
    const hit = aStart <= toYMD && aEnd >= fromYMD && (!notBefore || aEnd >= notBefore);
    return hit ? [{ startYMD: aStart, endYMD: aEnd }] : [];
  }

  const duration = Math.max(0, spanDays(aStart, aEnd)); // preserved, so a 3-day break stays 3 days
  const anchorYear = Number(aStart.slice(0, 4));
  const out = [];
  // Start a year early: a break running 30 Dec → 2 Jan belongs to a January window even
  // though its occurrence starts in the previous year.
  for (let y = Number(fromYMD.slice(0, 4)) - 1; y <= Number(toYMD.slice(0, 4)); y += 1) {
    // Nobody has a birthday before they were born. Other kinds of entry did exist
    // before this office wrote them down, so they show in earlier years too.
    if (h.type === 'BIRTHDAY' && y < anchorYear) continue;
    const startYMD = shiftToYear(aStart, y);
    const endYMD = addDays(startYMD, duration);
    if (startYMD > toYMD || endYMD < fromYMD) continue;
    if (notBefore && endYMD < notBefore) continue;
    out.push({ startYMD, endYMD });
  }
  return out;
}

/**
 * The occurrences of `h` that are allowed to count as non-working days.
 *
 * A repeat that has no start date was never switched on through the app — it can only
 * have been set directly in the database — so it is treated as a one-off here. Better
 * to under-count a holiday nobody asked the maths to honour than to silently rewrite
 * closed months.
 */
function countableOccurrences(h, fromYMD, toYMD) {
  if (!h.repeatsYearly) return occurrencesFor(h, fromYMD, toYMD);
  if (!h.repeatsFromYMD) return occurrencesFor(h, fromYMD, toYMD, { repeats: false });
  return occurrencesFor(h, fromYMD, toYMD, { notBefore: h.repeatsFromYMD });
}

export async function listHolidays({ year, month, from, to }) {
  let f = from;
  let t = to;
  if (year && month) {
    const mm = String(month).padStart(2, '0');
    const last = new Date(Number(year), Number(month), 0).getDate();
    f = `${year}-${mm}-01`;
    t = `${year}-${mm}-${String(last).padStart(2, '0')}`;
  } else if (year) {
    f = `${year}-01-01`;
    t = `${year}-12-31`;
  }

  // A window is required to expand repeats into, and this endpoint has always allowed
  // being called with none — default it rather than letting the expander divide by
  // undefined. A year either side of today covers every caller in the app.
  if (!f || !t) {
    const today = new Date().toISOString().slice(0, 10);
    const year = Number(today.slice(0, 4));
    f = f || `${year - 1}-01-01`;
    t = t || `${year + 1}-12-31`;
  }

  // A repeating entry's stored dates sit in its anchor year, which is usually nowhere
  // near the window being asked for — so it can't be filtered by date in the query.
  const holidays = await Holiday.find({
    $or: [{ repeatsYearly: true }, { $and: [{ startYMD: { $lte: t } }, { endYMD: { $gte: f } }] }],
  })
    .limit(500)
    .populate('createdBy', 'name');

  // A concrete entry always beats a generated one on the same day. Offices tend to have
  // last year's 15 August already typed in as its own row; without this, ticking
  // "repeats" would show two identical entries on that date forever.
  const concrete = new Set();
  for (const h of holidays) {
    if (h.repeatsYearly) continue;
    for (const ymd of enumerateDays(h.startYMD, h.endYMD)) concrete.add(`${h.type}|${h.title.trim().toLowerCase()}|${ymd}`);
  }

  const out = [];
  for (const h of holidays) {
    const json = h.toJSON();
    for (const occ of occurrencesFor(h, f, t)) {
      const isRepeat = h.repeatsYearly && occ.startYMD !== h.startYMD;
      if (isRepeat && concrete.has(`${h.type}|${h.title.trim().toLowerCase()}|${occ.startYMD}`)) continue;
      out.push({
        ...json,
        startYMD: occ.startYMD,
        endYMD: occ.endYMD,
        // The stored dates, so editing an occurrence edits the entry rather than
        // dragging its anchor — a birthday shown in 2027 must still save as the real DOB.
        anchorStartYMD: h.startYMD,
        anchorEndYMD: h.endYMD,
        isRepeat,
        // Whether this occurrence counts as a non-working day. The apply-leave preview
        // reads it so the client can't disagree with what the server will deduct.
        countsForWorkingDays: h.type === 'HOLIDAY' && (!h.repeatsYearly || (!!h.repeatsFromYMD && occ.endYMD >= h.repeatsFromYMD)),
        occurrenceId: `${json.id}@${occ.startYMD}`,
      });
    }
  }
  out.sort((a, b) => (a.startYMD < b.startYMD ? -1 : a.startYMD > b.startYMD ? 1 : 0));
  return out;
}

/**
 * Data for the printable annual holiday list (a notice-board PDF). Runs the same
 * calendar-year window through listHolidays — so repeats expand exactly as the calendar
 * shows them — drops BIRTHDAY rows always, and keeps the chosen types (public holidays
 * always; optional holidays and events by request). Shaped like buildLeaveLedger:
 * { company, period, rows } so reportPdf can render it in the same house style.
 */
export async function buildHolidayList(year, { optional = true, events = false } = {}) {
  const settings = await Setting.getSingleton();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const allow = new Set(['HOLIDAY']);
  if (optional) allow.add('OPTIONAL_HOLIDAY');
  if (events) allow.add('EVENT');

  const all = await listHolidays({ year }); // already sorted by date, repeats expanded
  const rows = all
    .filter((h) => h.type !== 'BIRTHDAY' && allow.has(h.type))
    .map((h) => ({
      date: h.startYMD,
      endDate: h.endYMD !== h.startYMD ? h.endYMD : null, // multi-day holidays keep their span
      weekday: new Date(`${h.startYMD}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }),
      title: h.title,
      type: h.type,
      description: h.description || '',
    }));

  return {
    company: { name: settings.companyName, currency: settings.currency, timezone: settings.timezone, brandColor: settings.brandColor, ...(await Setting.getLogos()) },
    generatedAt: new Date().toISOString(),
    period: { from, to, label: `Holidays ${year}`, year },
    included: { optional, events },
    rows,
  };
}

/**
 * Set of yyyy-MM-dd that fall on a mandatory HOLIDAY within [fromYMD, toYMD].
 *
 * This is the working-day calculation — it decides attendance sheets, report
 * denominators, leave deductions and the bonus month-end rollup. So a repeat counts
 * here only from the day it was switched on. Otherwise ticking "repeats every year" on
 * an existing 15 August would quietly turn a recorded absence into a holiday in every
 * closed month, changing reports people have already read. The calendar still shows
 * every occurrence; only the arithmetic is held back.
 */
export async function holidayYMDSet(fromYMD, toYMD) {
  const holidays = await Holiday.find({
    type: 'HOLIDAY',
    $or: [{ repeatsYearly: true }, { $and: [{ startYMD: { $lte: toYMD } }, { endYMD: { $gte: fromYMD } }] }],
  });
  const set = new Set();
  for (const h of holidays) {
    for (const occ of countableOccurrences(h, fromYMD, toYMD)) {
      for (const ymd of enumerateDays(occ.startYMD, occ.endYMD)) {
        if (ymd >= fromYMD && ymd <= toYMD) set.add(ymd);
      }
    }
  }
  return set;
}

/**
 * The day a newly-enabled repeat starts counting towards working days: today, or the
 * entry's own date if that is still ahead. Never earlier — see holidayYMDSet.
 */
function repeatStart(startYMD) {
  const today = ymdInTz(new Date());
  return startYMD > today ? startYMD : today;
}

/**
 * Mirror a user's profile date-of-birth onto their BIRTHDAY calendar entry. Called after
 * the profile saves a date of birth (the other direction — calendar → profile — lives in
 * createHoliday/updateHoliday): creates the entry when missing, moves it when the date
 * changes, removes it when the date is cleared. Idempotent, so repeated saves are safe.
 */
export async function syncBirthdayForUser(user) {
  const dob = (user?.dateOfBirth || '').slice(0, 10);
  const existing = await Holiday.findOne({ type: 'BIRTHDAY', userId: user._id });
  if (!dob) {
    if (existing) await existing.deleteOne();
    return;
  }
  const day = companyDayFromYMD(dob);
  if (existing) {
    existing.title = user.name;
    existing.startYMD = dob;
    existing.endYMD = dob;
    existing.startDate = day;
    existing.endDate = day;
    existing.repeatsYearly = true;
    if (!existing.repeatsFromYMD) existing.repeatsFromYMD = repeatStart(dob);
    await existing.save();
  } else {
    await Holiday.create({
      title: user.name,
      type: 'BIRTHDAY',
      startYMD: dob,
      endYMD: dob,
      startDate: day,
      endDate: day,
      repeatsYearly: true,
      repeatsFromYMD: repeatStart(dob),
      userId: user._id,
    });
  }
}

export async function createHoliday(creator, data) {
  const type = data.type || 'HOLIDAY';
  const startYMD = data.startYMD;
  // A birthday is one day and always comes back; there is no meaningful alternative.
  const endYMD = type === 'BIRTHDAY' ? startYMD : data.endYMD || data.startYMD;
  if (endYMD < startYMD) throw httpError(400, 'BAD_RANGE', 'End date is before the start date');
  if (type === 'BIRTHDAY' && startYMD > ymdInTz(new Date())) {
    throw httpError(400, 'BAD_DOB', 'A date of birth can’t be in the future');
  }
  const repeatsYearly = type === 'BIRTHDAY' ? true : !!data.repeatsYearly;
  // A birthday can be tied to a person (picked from the employee list). When it is, that
  // person's name is the label, and their profile date-of-birth is kept in sync from here.
  const linkedUserId = type === 'BIRTHDAY' && data.userId ? data.userId : null;
  let title = data.title;
  if (linkedUserId) {
    const u = await User.findById(linkedUserId).select('name');
    if (!u) throw httpError(404, 'NOT_FOUND', 'Selected employee not found');
    title = u.name;
  }

  const holiday = await Holiday.create({
    title,
    type,
    description: data.description || '',
    startYMD,
    endYMD,
    startDate: companyDayFromYMD(startYMD),
    endDate: companyDayFromYMD(endYMD),
    repeatsYearly,
    repeatsFromYMD: repeatsYearly ? repeatStart(startYMD) : '',
    userId: linkedUserId,
    createdBy: creator._id,
  });
  if (linkedUserId) await User.updateOne({ _id: linkedUserId }, { $set: { dateOfBirth: startYMD } });
  await holiday.populate('createdBy', 'name');
  return holiday.toJSON();
}

export async function updateHoliday(id, data) {
  const holiday = await Holiday.findById(id);
  if (!holiday) throw httpError(404, 'NOT_FOUND', 'Holiday not found');

  if (data.title !== undefined) holiday.title = data.title;
  if (data.type !== undefined) holiday.type = data.type;
  if (data.description !== undefined) holiday.description = data.description;
  // Re-link (or unlink) the birthday to an employee. When linked, the person's name is
  // the label and their profile date-of-birth is written back after the save below.
  if (data.userId !== undefined) holiday.userId = data.userId || null;
  if (data.startYMD !== undefined) {
    holiday.startYMD = data.startYMD;
    holiday.startDate = companyDayFromYMD(data.startYMD);
  }
  if (data.endYMD !== undefined) {
    holiday.endYMD = data.endYMD;
    holiday.endDate = companyDayFromYMD(data.endYMD);
  }

  const wasRepeating = holiday.repeatsYearly;
  if (data.repeatsYearly !== undefined) holiday.repeatsYearly = !!data.repeatsYearly;
  // Changing type to or from Birthday must carry the repeat with it — otherwise an
  // event converted from a birthday keeps repeating forever with nothing on screen
  // saying so.
  if (holiday.type === 'BIRTHDAY') {
    holiday.repeatsYearly = true;
    holiday.endYMD = holiday.startYMD;
    holiday.endDate = holiday.startDate;
    if (holiday.startYMD > ymdInTz(new Date())) throw httpError(400, 'BAD_DOB', 'A date of birth can’t be in the future');
    // Linked to a person → their name is the label (kept current even if they're renamed).
    if (holiday.userId) {
      const u = await User.findById(holiday.userId).select('name');
      if (!u) throw httpError(404, 'NOT_FOUND', 'Selected employee not found');
      holiday.title = u.name;
    }
  } else {
    holiday.userId = null; // a non-birthday can't be tied to a person's date of birth
    if (data.type !== undefined && data.type !== 'BIRTHDAY' && data.repeatsYearly === undefined && wasRepeating) {
      holiday.repeatsYearly = false; // was only repeating because it was a birthday
    }
  }

  if (holiday.repeatsYearly && !holiday.repeatsFromYMD) holiday.repeatsFromYMD = repeatStart(holiday.startYMD);
  if (!holiday.repeatsYearly) holiday.repeatsFromYMD = '';

  if (holiday.endYMD < holiday.startYMD) throw httpError(400, 'BAD_RANGE', 'End date is before the start date');

  await holiday.save();
  // Write the date of birth back to the linked profile so the two never disagree.
  if (holiday.type === 'BIRTHDAY' && holiday.userId) {
    await User.updateOne({ _id: holiday.userId }, { $set: { dateOfBirth: holiday.startYMD } });
  }
  await holiday.populate('createdBy', 'name');
  return holiday.toJSON();
}

/**
 * The four national holidays every Indian office closes for, put in on first boot so
 * nobody has to type them in — and, because they repeat, never again in any later year.
 *
 * These four are here because they are FIXED-DATE. Diwali, Holi and Eid move with the
 * lunar calendar and have to be added by hand each year; seeding them would be worse
 * than useless, because a wrong date on the calendar is trusted.
 *
 * Runs exactly once, guarded by a flag on the settings document. Deleting one of these
 * afterwards must make it stay deleted — a seeder that re-creates rows on every cold
 * start would be un-overridable, which is the opposite of a default.
 */
const DEFAULT_HOLIDAYS = [
  { monthDay: '01-26', title: 'Republic Day' },
  { monthDay: '08-15', title: 'Independence Day' },
  { monthDay: '10-02', title: 'Gandhi Jayanti' },
  { monthDay: '12-25', title: 'Christmas' },
];

export async function ensureDefaultHolidays() {
  const { Setting } = await import('../models/Setting.js');
  const settings = (await Setting.findOne({ key: 'global' })) || (await Setting.create({ key: 'global' }));
  if (settings.defaultHolidaysSeeded) return { added: 0, converted: 0, birthdays: 0 };

  // Every birthday already on the calendar starts repeating. There is no such thing as
  // a birthday that happens once, so this needs no toggle and no judgement — and a
  // birthday never counts towards working days, so nothing can move because of it.
  // Their stored year is whatever was typed at the time; correcting it to the real year
  // of birth is an edit the office can make whenever it likes.
  const birthdays = await Holiday.updateMany({ type: 'BIRTHDAY', repeatsYearly: { $ne: true } }, { $set: { repeatsYearly: true } });

  const existing = await Holiday.find({ type: 'HOLIDAY' });
  const today = ymdInTz(new Date());
  const year = Number(today.slice(0, 4));
  const toCreate = [];
  let converted = 0;

  for (const d of DEFAULT_HOLIDAYS) {
    // Most offices have already typed some of these in for the current year. A second
    // copy would be noise — but simply skipping would leave the one that IS there still
    // not repeating, which is the entire thing being asked for. So adopt it instead:
    // take the most recent entry on that day and switch its repeat on.
    const already = existing
      .filter((h) => h.startYMD.slice(5) === d.monthDay)
      .sort((a, b) => (a.startYMD < b.startYMD ? 1 : -1));

    if (already.length) {
      const keep = already[0];
      if (!keep.repeatsYearly) {
        keep.repeatsYearly = true;
        keep.repeatsFromYMD = repeatStart(keep.startYMD);
        await keep.save();
        converted += 1;
      }
      continue;
    }

    const startYMD = `${year}-${d.monthDay}`;
    toCreate.push({
      title: d.title,
      type: 'HOLIDAY',
      description: '',
      startYMD,
      endYMD: startYMD,
      startDate: companyDayFromYMD(startYMD),
      endDate: companyDayFromYMD(startYMD),
      repeatsYearly: true,
      // Counts towards working days from today onwards only, exactly like a repeat
      // switched on by hand — seeding must not restate any month already closed.
      repeatsFromYMD: repeatStart(startYMD),
      createdBy: null,
    });
  }

  if (toCreate.length) await Holiday.insertMany(toCreate);

  settings.defaultHolidaysSeeded = true;
  await settings.save();
  return { added: toCreate.length, converted, birthdays: birthdays.modifiedCount || 0 };
}

export async function deleteHoliday(id) {
  const holiday = await Holiday.findById(id);
  if (!holiday) throw httpError(404, 'NOT_FOUND', 'Holiday not found');
  await holiday.deleteOne();
  // A linked birthday and the profile date-of-birth are one fact in two places — removing
  // the calendar entry clears the profile date too, so they can never fall out of step.
  if (holiday.type === 'BIRTHDAY' && holiday.userId) {
    await User.updateOne({ _id: holiday.userId }, { $set: { dateOfBirth: '' } });
  }
  return { success: true };
}
