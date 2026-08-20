import { Visitor } from '../models/Visitor.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { notify } from '../models/Notification.js';
import { can } from '../lib/permissions.js';
import { companyDayFromYMD, ymdInTz, formatCompany } from '../lib/time.js';

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ── Categories (leadership-managed) ─────────────────────── */
export async function listCategories() {
  const s = await Setting.getSingleton();
  const configured = s.visitorCategories?.length ? s.visitorCategories : ['Visitors', 'Finance'];
  // Union with categories still present on old entries, so a deleted label's
  // records stay reachable through the filter.
  const used = await Visitor.distinct('category');
  return [...new Set([...configured, ...used.filter(Boolean)])];
}

export async function addCategory(label) {
  const name = String(label || '').trim();
  if (!name) throw httpError(400, 'INVALID', 'Enter a category name');
  const s = await Setting.getSingleton();
  const cats = s.visitorCategories?.length ? s.visitorCategories : ['Visitors', 'Finance'];
  if (cats.some((c) => c.toLowerCase() === name.toLowerCase())) {
    throw httpError(409, 'DUPLICATE', 'That category already exists');
  }
  s.visitorCategories = [...cats, name];
  await s.save();
  return s.visitorCategories;
}

export async function removeCategory(name) {
  const s = await Setting.getSingleton();
  const cats = (s.visitorCategories?.length ? s.visitorCategories : ['Visitors', 'Finance']).filter((c) => c !== name);
  s.visitorCategories = cats.length ? cats : ['Visitors'];
  await s.save();
  return s.visitorCategories;
}

/* ── People suggestions for the "whom to meet" typeahead ── */
export async function peopleSuggestions() {
  const users = await User.find({ isActive: true }).select('name designation role').sort({ name: 1 });
  // `id` travels so the form can record WHICH employee was picked (toMeetUser), which is
  // what lets us alert the host on arrival.
  return users.map((u) => ({ id: u.id, name: u.name, designation: u.designation || '' }));
}

/**
 * Alert the host that their visitor has arrived — deliberately narrow:
 *  - only a live arrival: logged for TODAY and not already checked out (a back-dated or
 *    already-completed entry is a record, not an arrival);
 *  - the host is resolved from the picked user id, or failing that an EXACT single
 *    name match among active users (so a free-typed full name still works, but an
 *    ambiguous or partial one doesn't guess);
 *  - never the person who logged the entry (no self-ping);
 *  - ONLY if the host can open the visitor register — the notification links to
 *    /visitors, so sending it to someone without access would be a dead end.
 * Fire-and-forget: a hiccup here must never fail logging the visitor.
 */
async function maybeAlertHost(visitor, creator) {
  // A pre-registered (EXPECTED) visitor hasn't arrived yet — the host is pinged on
  // check-in, not when the entry is created.
  if (visitor.status === 'EXPECTED') return;
  if (visitor.dateYMD !== ymdInTz(new Date()) || visitor.checkOutTime) return;

  let host = null;
  if (visitor.toMeetUser) {
    host = await User.findById(visitor.toMeetUser).select('name role isActive');
  } else if (visitor.toMeet && visitor.toMeet.trim()) {
    const rx = new RegExp(`^${escapeRegex(visitor.toMeet.trim())}$`, 'i');
    const matches = await User.find({ isActive: true, name: rx }).select('name role isActive').limit(2);
    if (matches.length === 1) [host] = matches;
  }
  if (!host || host.isActive === false) return;
  if (String(host._id) === String(creator._id)) return;
  if (!can(host, 'manageVisitors')) return; // no register access → dead link → no ping

  const bits = [visitor.company, visitor.purpose].map((s) => (s || '').trim()).filter(Boolean);
  await notify({
    user: host._id,
    type: 'VISITOR',
    title: `${visitor.name} is here to see you`,
    message: bits.length ? `${bits.join(' · ')} — at reception` : 'Waiting at reception',
    link: '/visitors',
    entityType: 'Visitor',
    entityId: visitor._id,
  });
}

/* ── Entries ─────────────────────────────────────────────── */
export async function createVisitor(user, data) {
  const status = data.status === 'EXPECTED' ? 'EXPECTED' : 'ARRIVED';
  const v = await Visitor.create({
    name: data.name,
    phone: data.phone || '',
    category: data.category,
    fromPlace: data.fromPlace || '',
    company: data.company || '',
    toMeet: data.toMeet || '',
    toMeetUser: data.toMeetUser || null,
    purpose: data.purpose || '',
    dateYMD: data.dateYMD,
    date: companyDayFromYMD(data.dateYMD),
    // A pre-registered visitor has no arrival time yet, whatever the form sent.
    checkInTime: status === 'EXPECTED' ? '' : (data.checkInTime || ''),
    checkOutTime: status === 'EXPECTED' ? '' : (data.checkOutTime || ''),
    status,
    scheduledFor: status === 'EXPECTED' ? (data.scheduledFor || data.dateYMD) : (data.scheduledFor || ''),
    createdBy: user._id,
  });
  await v.populate('createdBy', 'name');
  // Tell the host their visitor is here (best-effort; never blocks logging the entry).
  // Skipped for EXPECTED inside maybeAlertHost — the ping waits for check-in.
  await maybeAlertHost(v, user).catch((e) => console.error('visitor host alert failed:', e?.message));
  return v.toJSON();
}

/**
 * Check in a pre-registered (or any) visitor on arrival: flip to ARRIVED, stamp the
 * arrival time and move the visit date to today, then ping the host — the arrival alert
 * that was deliberately held back at pre-register time. Idempotent-ish: checking in
 * someone already in office just refreshes nothing important and never re-alerts if they
 * were already ARRIVED with a check-in.
 */
export async function checkInVisitor(id, user, data = {}) {
  const v = await Visitor.findById(id);
  if (!v) throw httpError(404, 'NOT_FOUND', 'Visitor entry not found');
  if (v.checkOutTime) throw httpError(400, 'ALREADY_OUT', 'This visitor has already checked out');
  const wasExpected = v.status === 'EXPECTED' || !v.checkInTime;
  const today = ymdInTz(new Date());
  v.status = 'ARRIVED';
  // Prefer a client-supplied HH:mm (the reception clock), else stamp company time now.
  if (!v.checkInTime) v.checkInTime = data.checkInTime || formatCompany(new Date(), 'HH:mm');
  // Only a genuine arrival moves the visit onto today's register. Re-checking-in someone
  // already in office (e.g. a stray call on an ARRIVED row) must NOT relocate their
  // existing visit to a different day.
  if (wasExpected) {
    v.dateYMD = today;
    v.date = companyDayFromYMD(today);
  }
  await v.save();
  await v.populate('createdBy', 'name');
  // Only ping on a genuine arrival (they were expected / had no check-in) — never on a
  // no-op re-check-in of someone already inside.
  if (wasExpected) await maybeAlertHost(v, user).catch((e) => console.error('visitor host alert failed:', e?.message));
  return v.toJSON();
}

export async function updateVisitor(id, data) {
  const v = await Visitor.findById(id);
  if (!v) throw httpError(404, 'NOT_FOUND', 'Visitor entry not found');
  // Once a visitor has checked out, their visit times are a finalised record: every
  // other detail can still be corrected, but the check-in / check-out time cannot.
  // (The check-out action itself still works — that's the first time it's ever set.)
  const timesLocked = !!v.checkOutTime;
  const editable = ['name', 'phone', 'category', 'fromPlace', 'company', 'toMeet', 'purpose'];
  if (!timesLocked) editable.push('checkInTime', 'checkOutTime');
  for (const f of editable) {
    if (data[f] !== undefined) v[f] = data[f];
  }
  // Handled apart from the loop: '' must become null, not an invalid ObjectId cast.
  // Correcting the host on an edit doesn't re-alert — the arrival ping is create-only.
  if (data.toMeetUser !== undefined) v.toMeetUser = data.toMeetUser || null;
  if (data.dateYMD !== undefined) {
    v.dateYMD = data.dateYMD;
    v.date = companyDayFromYMD(data.dateYMD);
  }
  // Rescheduling a pre-registered visitor: keep scheduledFor in step with the new date,
  // otherwise the "Expected · <date>" chip (which reads scheduledFor) shows the old day.
  if (data.scheduledFor !== undefined) v.scheduledFor = data.scheduledFor;
  // A visit can't end before it started. Checked only when this request is actually
  // SETTING one of the times: an entry that already holds a bad pair (or a same-minute
  // in-and-out) must still be editable for its name, company or purpose, and a guard
  // that fired on every save would have made such a row permanently uneditable. Equal
  // times are allowed — someone signing in and straight back out inside the same minute
  // is a real thing, and the times are recorded only to the minute.
  const touchingTimes = data.checkInTime !== undefined || data.checkOutTime !== undefined;
  if (touchingTimes && v.checkInTime && v.checkOutTime && v.checkOutTime < v.checkInTime) {
    throw httpError(400, 'BAD_RANGE', 'Check-out time must be after check-in. Edit the entry to set the time they actually left.');
  }
  await v.save();
  await v.populate('createdBy', 'name');
  return v.toJSON();
}

export async function deleteVisitor(id) {
  const v = await Visitor.findByIdAndDelete(id);
  if (!v) throw httpError(404, 'NOT_FOUND', 'Visitor entry not found');
  return { success: true };
}

export async function listVisitors({ from, to, category, search, page = 1, limit = 20, sort = 'date_desc' }) {
  const filter = {};
  if (from || to) {
    filter.dateYMD = {};
    if (from) filter.dateYMD.$gte = from;
    if (to) filter.dateYMD.$lte = to;
  }
  if (category) filter.category = category;
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: rx }, { company: rx }, { toMeet: rx }, { fromPlace: rx }, { phone: rx }];
  }

  const sortMap = {
    date_desc: { dateYMD: -1, checkInTime: -1, createdAt: -1 },
    date_asc: { dateYMD: 1, checkInTime: 1 },
    name_asc: { name: 1 },
    name_desc: { name: -1 },
  };
  const sortBy = sortMap[sort] || sortMap.date_desc;
  const skip = (page - 1) * limit;

  const [visitors, total, openVisits, expected] = await Promise.all([
    Visitor.find(filter).sort(sortBy).skip(skip).limit(limit).populate('createdBy', 'name'),
    Visitor.countDocuments(filter),
    // "Still in office" — checked in, not checked out, and a real arrival (not a pending
    // pre-registration). GLOBAL (not scoped to the filter/page) so the tile is a true
    // right-now figure. Two cheap counts, never a re-scan of every row (see V16).
    Visitor.countDocuments({ status: { $ne: 'EXPECTED' }, checkInTime: { $ne: '' }, checkOutTime: '' }),
    Visitor.countDocuments({ status: 'EXPECTED' }),
  ]);
  return { visitors: visitors.map((v) => v.toJSON()), total, page, limit, summary: { openVisits, expected } };
}
