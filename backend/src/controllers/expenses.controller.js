import { ok, fail } from '../lib/apiResponse.js';
import {
  createExpenseSchema,
  updateExpenseSchema,
  listExpensesQuerySchema,
  summaryQuerySchema,
} from '../validators/expenses.validators.js';
import * as svc from '../services/expense.service.js';
import { computePeriod, previousPeriod } from '../services/report.service.js';
import { ymdInTz } from '../lib/time.js';
import { Setting } from '../models/Setting.js';
import { audit } from '../models/AuditLog.js';
import { toCsv } from '../lib/csv.js';

function handleErr(res, err, next) {
  if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
  return next(err);
}

export async function meta(_req, res, next) {
  try {
    const settings = await Setting.getSingleton();
    res.json(
      ok({
        categories: settings.expenseCategories,
        currency: settings.currency,
        paymentMethods: ['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'OTHER'],
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function list(req, res, next) {
  try {
    const q = listExpensesQuerySchema.parse(req.query);
    res.json(ok(await svc.listExpenses(q)));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function summary(req, res, next) {
  try {
    const q = summaryQuerySchema.parse(req.query);
    // Resolve the window here rather than trusting dates worked out on the device.
    // computePeriod already owns the fiscal year (Apr–Mar) and the reports module uses
    // it, so this cannot drift from them; previousPeriod steps the anchor back a whole
    // month/quarter/year instead of subtracting a day count, which is the only way
    // "vs last month" is true in February.
    // No period named + explicit dates = the old from/to callers, unchanged.
    const type = q.period || (q.from || q.to ? 'custom' : 'yearly');
    const anchor = q.date || ymdInTz(new Date());
    const range = { from: q.from, to: q.to };
    const period = computePeriod(type, anchor, range);
    const prev = previousPeriod(type, anchor, range);

    const data = await svc.expenseSummary({
      category: q.category,
      paymentMethod: q.paymentMethod,
      search: q.search,
      from: period.from,
      to: period.to,
      prevFrom: prev.from,
      prevTo: prev.to,
    });
    res.json(ok({ ...data, period: { type, ...period }, previousLabel: prev.label }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function exportCsv(req, res, next) {
  try {
    const q = listExpensesQuerySchema.parse(req.query);
    const { expenses } = await svc.listExpenses({ ...q, page: 1, limit: 10000 });
    const header = ['Date', 'Title', 'Vendor', 'Category', 'Method', 'Amount', 'Notes'];
    const rows = expenses.map((e) => [
      e.dateYMD,
      e.title,
      e.vendor || '',
      e.category,
      e.paymentMethod,
      (e.amount / 100).toFixed(2),
      (e.notes || '').replace(/\s+/g, ' ').trim(),
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="expenses.csv"');
    res.send(toCsv(header, rows));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function create(req, res, next) {
  try {
    const body = createExpenseSchema.parse(req.body);
    const expense = await svc.createExpense(req.user, body);
    await audit({ actor: req.user._id, action: 'expense.create', entityType: 'Expense', entityId: expense.id, meta: { amount: expense.amount, category: expense.category } });
    res.status(201).json(ok({ expense }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function update(req, res, next) {
  try {
    const body = updateExpenseSchema.parse(req.body);
    const expense = await svc.updateExpense(req.params.id, body);
    await audit({ actor: req.user._id, action: 'expense.update', entityType: 'Expense', entityId: req.params.id });
    res.json(ok({ expense }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function remove(req, res, next) {
  try {
    await svc.deleteExpense(req.params.id);
    await audit({ actor: req.user._id, action: 'expense.delete', entityType: 'Expense', entityId: req.params.id });
    res.json(ok({ success: true }));
  } catch (err) {
    handleErr(res, err, next);
  }
}
