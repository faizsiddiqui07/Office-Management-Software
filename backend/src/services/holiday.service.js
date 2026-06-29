import { Holiday } from '../models/Holiday.js';
import { companyDayFromYMD } from '../lib/time.js';

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

  const filter = {};
  const and = [];
  if (t) and.push({ startYMD: { $lte: t } });
  if (f) and.push({ endYMD: { $gte: f } });
  if (and.length) filter.$and = and;

  const holidays = await Holiday.find(filter).sort({ startYMD: 1 }).limit(500).populate('createdBy', 'name');
  return holidays.map((h) => h.toJSON());
}

/** Set of yyyy-MM-dd that fall on a mandatory HOLIDAY within [fromYMD, toYMD]. */
export async function holidayYMDSet(fromYMD, toYMD) {
  const holidays = await Holiday.find({
    type: 'HOLIDAY',
    startYMD: { $lte: toYMD },
    endYMD: { $gte: fromYMD },
  });
  const set = new Set();
  for (const h of holidays) {
    for (const ymd of enumerateDays(h.startYMD, h.endYMD)) {
      if (ymd >= fromYMD && ymd <= toYMD) set.add(ymd);
    }
  }
  return set;
}

export async function createHoliday(creator, data) {
  const startYMD = data.startYMD;
  const endYMD = data.endYMD || data.startYMD;
  if (endYMD < startYMD) throw httpError(400, 'BAD_RANGE', 'End date is before the start date');

  const holiday = await Holiday.create({
    title: data.title,
    type: data.type || 'HOLIDAY',
    description: data.description || '',
    startYMD,
    endYMD,
    startDate: companyDayFromYMD(startYMD),
    endDate: companyDayFromYMD(endYMD),
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
