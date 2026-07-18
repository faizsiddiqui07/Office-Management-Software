import { Expense } from '../models/Expense.js';
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
  const filter = {};
  if (from || to) {
    filter.dateYMD = {};
    if (from) filter.dateYMD.$gte = from;
    if (to) filter.dateYMD.$lte = to;
  }
  if (category) filter.category = category;
  if (paymentMethod) filter.paymentMethod = paymentMethod;
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ title: rx }, { vendor: rx }];
  }

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

export async function expenseSummary({ from, to }) {
  const match = {};
  if (from || to) {
    match.dateYMD = {};
    if (from) match.dateYMD.$gte = from;
    if (to) match.dateYMD.$lte = to;
  }

  const [byCategory, byMonth, overall] = await Promise.all([
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: { $substr: ['$dateYMD', 0, 7] }, total: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]),
    Expense.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
  ]);

  return {
    byCategory: byCategory.map((c) => ({ category: c._id, total: c.total, count: c.count })),
    byMonth: byMonth.map((m) => ({ month: m._id, total: m.total })),
    total: overall[0]?.total ?? 0,
    count: overall[0]?.count ?? 0,
  };
}
