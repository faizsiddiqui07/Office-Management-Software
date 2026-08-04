import { Expense } from '../models/Expense.js';
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

/**
 * The one place expense filters are built. The list, the summary and the CSV export
 * all go through it, so a row visible in the table can never be missing from the
 * totals above it — which is the whole point of the expenses page.
 *
 * `skip` leaves one dimension out. A breakdown must not be filtered by its own
 * dimension: filtering by category and then grouping by category leaves a pie with
 * one slice and no way to pick a different one.
 */
function buildExpenseFilter({ from, to, category, paymentMethod, search }, skip = '') {
  const filter = {};
  if (from || to) {
    filter.dateYMD = {};
    if (from) filter.dateYMD.$gte = from;
    if (to) filter.dateYMD.$lte = to;
  }
  if (category && skip !== 'category') filter.category = category;
  if (paymentMethod && skip !== 'paymentMethod') filter.paymentMethod = paymentMethod;
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ title: rx }, { vendor: rx }];
  }
  return filter;
}

export async function createExpense(user, data) {
  const expense = await Expense.create({
    title: data.title,
    amount: data.amount,
    currency: data.currency || 'INR',
    category: data.category,
    dateYMD: data.dateYMD,
    date: companyDayFromYMD(data.dateYMD),
    paymentMethod: data.paymentMethod || 'CASH',
    vendor: data.vendor || '',
    notes: data.notes || '',
    addedBy: user._id,
  });
  await expense.populate('addedBy', 'name');
  return expense.toJSON();
}

export async function updateExpense(id, data) {
  const expense = await Expense.findById(id);
  if (!expense) throw httpError(404, 'NOT_FOUND', 'Expense not found');

  for (const f of ['title', 'amount', 'currency', 'category', 'paymentMethod', 'vendor', 'notes']) {
    if (data[f] !== undefined) expense[f] = data[f];
  }
  if (data.dateYMD !== undefined) {
    expense.dateYMD = data.dateYMD;
    expense.date = companyDayFromYMD(data.dateYMD);
  }

  await expense.save();
  await expense.populate('addedBy', 'name');
  return expense.toJSON();
}

export async function deleteExpense(id) {
  const expense = await Expense.findByIdAndDelete(id);
  if (!expense) throw httpError(404, 'NOT_FOUND', 'Expense not found');
  return { success: true };
}

export async function listExpenses({ from, to, category, paymentMethod, search, page = 1, limit = 20, sort = 'date_desc' }) {
  const filter = buildExpenseFilter({ from, to, category, paymentMethod, search });

  const sortMap = {
    date_desc: { dateYMD: -1, createdAt: -1 },
    date_asc: { dateYMD: 1 },
    amount_desc: { amount: -1 },
    amount_asc: { amount: 1 },
  };
  const sortBy = sortMap[sort] || sortMap.date_desc;
  const skip = (page - 1) * limit;

  const [expenses, total] = await Promise.all([
    Expense.find(filter).sort(sortBy).skip(skip).limit(limit).populate('addedBy', 'name'),
    Expense.countDocuments(filter),
  ]);
  return { expenses: expenses.map((e) => e.toJSON()), total, page, limit };
}

/**
 * Distinct non-empty values of a text field, most-recently-used first and capped — for the
 * vendor/title auto-suggest. $trim folds 'Staples' and 'Staples ' into one entry, which is
 * exactly what stops category totals and the duplicate guard splitting on stray spaces.
 */
async function recentDistinct(field, cap = 50) {
  const rows = await Expense.aggregate([
    { $group: { _id: { $trim: { input: { $ifNull: [`$${field}`, ''] } } }, last: { $max: '$createdAt' } } },
    { $match: { _id: { $ne: '' } } },
    { $sort: { last: -1 } },
    { $limit: cap },
  ]);
  return rows.map((r) => r._id);
}

/** Vendor and title suggestions for the add/edit-expense form. */
export async function expenseSuggestions() {
  const [vendors, titles] = await Promise.all([recentDistinct('vendor'), recentDistinct('title')]);
  return { vendors, titles };
}

/** The twelve months ending with `to` — the trend window, independent of the period. */
function trailingTwelve(to) {
  const end = to ? new Date(`${to}T00:00:00Z`) : new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  return { from: start.toISOString().slice(0, 10), to: to || end.toISOString().slice(0, 10) };
}

/**
 * Everything the expenses page shows above the table, from one call.
 *
 * All amounts are paise (integer minor units), like everywhere else in this module.
 *
 * Three things are deliberately NOT filtered the same way:
 *  - byCategory ignores the category filter, and byMethod ignores the method filter,
 *    so both stay usable as pickers after you've picked (see buildExpenseFilter).
 *  - `trend` always covers the trailing twelve months rather than the chosen period,
 *    so picking "this month" doesn't reduce the bar chart to a single bar. It still
 *    honours category/method/search, which is what makes it worth looking at.
 *  - byMonth keeps its original meaning (grouped over the chosen range) because the
 *    dashboard reads it — do not repoint it at `trend`.
 */
export async function expenseSummary({ from, to, category, paymentMethod, search, prevFrom, prevTo }) {
  const base = { from, to, category, paymentMethod, search };
  const match = buildExpenseFilter(base);
  const catMatch = buildExpenseFilter(base, 'category');
  const methodMatch = buildExpenseFilter(base, 'paymentMethod');

  const span = trailingTwelve(to);
  const trendMatch = buildExpenseFilter({ ...base, from: span.from, to: span.to });

  // Both bounds or nothing: a half-supplied pair would silently compare against an
  // open-ended window rather than the previous period.
  const prevMatch = prevFrom && prevTo ? buildExpenseFilter({ ...base, from: prevFrom, to: prevTo }) : null;

  const totals = [{ $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }];

  const [byCategory, byMonth, byMethod, trend, overall, previous] = await Promise.all([
    Expense.aggregate([
      { $match: catMatch },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: { $substr: ['$dateYMD', 0, 7] }, total: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]),
    Expense.aggregate([
      { $match: methodMatch },
      // Falls back to CASH, matching the schema default — anything else would count a
      // row here that the table renders as a different method.
      { $group: { _id: { $ifNull: ['$paymentMethod', 'CASH'] }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    Expense.aggregate([
      { $match: trendMatch },
      { $group: { _id: { $substr: ['$dateYMD', 0, 7] }, total: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]),
    Expense.aggregate([{ $match: match }, ...totals]),
    prevMatch ? Expense.aggregate([{ $match: prevMatch }, ...totals]) : Promise.resolve([]),
  ]);

  return {
    byCategory: byCategory.map((c) => ({ category: c._id, total: c.total, count: c.count })),
    byMonth: byMonth.map((m) => ({ month: m._id, total: m.total })),
    byMethod: byMethod.map((m) => ({ method: m._id, total: m.total, count: m.count })),
    trend: trend.map((m) => ({ month: m._id, total: m.total })),
    trendFrom: span.from,
    total: overall[0]?.total ?? 0,
    count: overall[0]?.count ?? 0,
    previous: prevMatch
      ? { total: previous[0]?.total ?? 0, count: previous[0]?.count ?? 0, from: prevFrom, to: prevTo }
      : null,
  };
}

// The itemised list on the statement is capped so a huge slice can't produce a
// thousand-page PDF; the total and category figures still cover everything, and the note
// says "latest N of M". Generous enough that a normal filtered slice is never truncated.
const STATEMENT_LIST_CAP = 500;

/**
 * Everything the printable expense statement needs — the EXACT filtered slice the user is
 * looking at (period, category, method, search), shaped for reportPdf's expensesSection.
 *
 * Unlike expenseSummary — whose byCategory deliberately IGNORES the category filter so the
 * page's picker stays usable after you've picked — here the category breakdown and the
 * total both honour every filter, so the figures and the itemised rows describe one and
 * the same slice (they'd otherwise disagree the moment a category was chosen).
 */
export async function buildExpenseStatement({ from, to, category, paymentMethod, search }) {
  const filter = buildExpenseFilter({ from, to, category, paymentMethod, search });

  const [byCategory, overall, list, settings] = await Promise.all([
    Expense.aggregate([
      { $match: filter },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    Expense.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    Expense.find(filter).sort({ dateYMD: -1, createdAt: -1 }).limit(STATEMENT_LIST_CAP),
    Setting.getSingleton(),
  ]);

  const total = overall[0]?.total ?? 0;
  const count = overall[0]?.count ?? 0;

  const fmt = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const rangeLabel = from && to ? `${fmt(from)} – ${fmt(to)}` : from ? `From ${fmt(from)}` : to ? `Until ${fmt(to)}` : 'All dates';
  const scopeParts = [rangeLabel];
  if (category) scopeParts.push(`Category: ${category.replace(/_/g, ' ')}`);
  if (paymentMethod) scopeParts.push(`Method: ${paymentMethod.replace(/_/g, ' ')}`);
  if (search) scopeParts.push(`Search: “${search}”`);

  return {
    company: { name: settings.companyName, currency: settings.currency, timezone: settings.timezone, brandColor: settings.brandColor, logoUrl: settings.logoUrl, logoLight: settings.logoLight, logoDark: settings.logoDark },
    generatedAt: new Date().toISOString(),
    period: { from, to, label: rangeLabel },
    scope: scopeParts.join('   ·   '),
    expenses: {
      total,
      count,
      byCategory: byCategory.map((c) => ({ category: c._id, total: c.total, count: c.count })),
      list: list.map((e) => ({ dateYMD: e.dateYMD, title: e.title, category: e.category, paymentMethod: e.paymentMethod, amount: e.amount })),
      listCount: list.length,
      listCapped: count > list.length,
    },
  };
}
