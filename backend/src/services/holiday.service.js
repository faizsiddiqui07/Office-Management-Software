import { Holiday } from '../models/Holiday.js';
import { companyDayFromYMD, ymdInTz } from '../lib/time.js';

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
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

  const holiday = await Holiday.create({
    title: data.title,
    type,
    description: data.description || '',
    startYMD,
    endYMD,
    startDate: companyDayFromYMD(startYMD),
    endDate: companyDayFromYMD(endYMD),
    repeatsYearly,
    repeatsFromYMD: repeatsYearly ? repeatStart(startYMD) : '',
    createdBy: creator._id,
  });
  await holiday.populate('createdBy', 'name');
  return holiday.toJSON();
}

export async function updateHoliday(id, data) {
  const holiday = await Holiday.findById(id);
  if (!holiday) throw httpError(404, 'NOT_FOUND', 'Holiday not found');

  if (data.title !== undefined) holiday.title = data.title;
  if (data.type !== undefined) holiday.type = data.type;
  if (data.description !== undefined) holiday.description = data.description;
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
  } else if (data.type !== undefined && data.type !== 'BIRTHDAY' && data.repeatsYearly === undefined && wasRepeating) {
    holiday.repeatsYearly = false; // was only repeating because it was a birthday
  }

  if (holiday.repeatsYearly && !holiday.repeatsFromYMD) holiday.repeatsFromYMD = repeatStart(holiday.startYMD);
  if (!holiday.repeatsYearly) holiday.repeatsFromYMD = '';

  if (holiday.endYMD < holiday.startYMD) throw httpError(400, 'BAD_RANGE', 'End date is before the start date');

  await holiday.save();
  await holiday.populate('createdBy', 'name');
  return holiday.toJSON();
}

export async function deleteHoliday(id) {
  const holiday = await Holiday.findByIdAndDelete(id);
  if (!holiday) throw httpError(404, 'NOT_FOUND', 'Holiday not found');
  return { success: true };
}
