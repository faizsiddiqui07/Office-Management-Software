import { Visitor } from '../models/Visitor.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { companyDayFromYMD } from '../lib/time.js';

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
  return users.map((u) => ({ name: u.name, designation: u.designation || '' }));
}

/* ── Entries ─────────────────────────────────────────────── */
export async function createVisitor(user, data) {
  const v = await Visitor.create({
    name: data.name,
    phone: data.phone || '',
    category: data.category,
    fromPlace: data.fromPlace || '',
    company: data.company || '',
    toMeet: data.toMeet || '',
    purpose: data.purpose || '',
    dateYMD: data.dateYMD,
    date: companyDayFromYMD(data.dateYMD),
    checkInTime: data.checkInTime || '',
    checkOutTime: data.checkOutTime || '',
    createdBy: user._id,
  });
  await v.populate('createdBy', 'name');
  return v.toJSON();
}

export async function updateVisitor(id, data) {
  const v = await Visitor.findById(id);
  if (!v) throw httpError(404, 'NOT_FOUND', 'Visitor entry not found');
  for (const f of ['name', 'phone', 'category', 'fromPlace', 'company', 'toMeet', 'purpose', 'checkInTime', 'checkOutTime']) {
    if (data[f] !== undefined) v[f] = data[f];
  }
  if (data.dateYMD !== undefined) {
    v.dateYMD = data.dateYMD;
    v.date = companyDayFromYMD(data.dateYMD);
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

  const [visitors, total] = await Promise.all([
    Visitor.find(filter).sort(sortBy).skip(skip).limit(limit).populate('createdBy', 'name'),
    Visitor.countDocuments(filter),
  ]);
  return { visitors: visitors.map((v) => v.toJSON()), total, page, limit };
}
