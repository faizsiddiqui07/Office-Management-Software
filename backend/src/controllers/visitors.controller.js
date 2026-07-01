import { ok, fail } from '../lib/apiResponse.js';
import {
  createVisitorSchema,
  updateVisitorSchema,
  listVisitorsQuerySchema,
  addCategorySchema,
} from '../validators/visitors.validators.js';
import * as svc from '../services/visitor.service.js';
import { Setting } from '../models/Setting.js';
import { audit } from '../models/AuditLog.js';
import { toCsv } from '../lib/csv.js';
import { renderVisitorsPdf } from '../services/visitorPdf.service.js';
import { loadCompanyLogo } from '../lib/brand.js';

function handleErr(res, err, next) {
  if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
  return next(err);
}

export async function meta(_req, res, next) {
  try {
    res.json(ok({ categories: await svc.listCategories() }));
  } catch (err) {
    next(err);
  }
}

export async function people(_req, res, next) {
  try {
    res.json(ok({ people: await svc.peopleSuggestions() }));
  } catch (err) {
    next(err);
  }
}

export async function list(req, res, next) {
  try {
    const q = listVisitorsQuerySchema.parse(req.query);
    res.json(ok(await svc.listVisitors(q)));
  } catch (err) {
    handleErr(res, err, next);
  }
}

function csvOf(visitors) {
  const header = ['Date', 'Name', 'Phone', 'Category', 'From', 'Who / Company', 'To meet', 'Check-in', 'Check-out', 'Purpose', 'Logged by'];
  const rows = visitors.map((v) => [
    v.dateYMD,
    v.name,
    v.phone || '',
    v.category,
    v.fromPlace || '',
    v.company || '',
    v.toMeet || '',
    v.checkInTime || '',
    v.checkOutTime || '',
    (v.purpose || '').replace(/\s+/g, ' ').trim(),
    v.createdBy?.name || '',
  ]);
  return toCsv(header, rows);
}

export async function exportCsv(req, res, next) {
  try {
    const q = listVisitorsQuerySchema.parse(req.query);
    const { visitors } = await svc.listVisitors({ ...q, page: 1, limit: 10000 });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="visitors.csv"');
    res.send(csvOf(visitors));
  } catch (err) {
    handleErr(res, err, next);
  }
}

function periodLabel(from, to) {
  if (from && to) return from === to ? from : `${from} → ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return 'All entries';
}

export async function exportPdf(req, res, next) {
  try {
    const q = listVisitorsQuerySchema.parse(req.query);
    const { visitors } = await svc.listVisitors({ ...q, page: 1, limit: 10000 });
    const s = await Setting.getSingleton();
    const data = {
      company: { name: s.companyName, brandColor: s.brandColor },
      period: { from: q.from, to: q.to, label: periodLabel(q.from, q.to) },
      generatedAt: new Date().toISOString().slice(0, 10),
      visitors,
    };
    const logo = loadCompanyLogo(s.logoDark || s.logoUrl || s.logoLight);
    const stream = await renderVisitorsPdf(data, logo);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="visitors.pdf"');
    stream.pipe(res);
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function create(req, res, next) {
  try {
    const body = createVisitorSchema.parse(req.body);
    const visitor = await svc.createVisitor(req.user, body);
    await audit({ actor: req.user._id, action: 'visitor.create', entityType: 'Visitor', entityId: visitor.id, meta: { category: visitor.category } });
    res.status(201).json(ok({ visitor }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function update(req, res, next) {
  try {
    const body = updateVisitorSchema.parse(req.body);
    const visitor = await svc.updateVisitor(req.params.id, body);
    await audit({ actor: req.user._id, action: 'visitor.update', entityType: 'Visitor', entityId: req.params.id });
    res.json(ok({ visitor }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function remove(req, res, next) {
  try {
    await svc.deleteVisitor(req.params.id);
    await audit({ actor: req.user._id, action: 'visitor.delete', entityType: 'Visitor', entityId: req.params.id });
    res.json(ok({ success: true }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function addCategory(req, res, next) {
  try {
    const { label } = addCategorySchema.parse(req.body);
    const categories = await svc.addCategory(label);
    await audit({ actor: req.user._id, action: 'visitor.category.add', entityType: 'Setting', entityId: 'global', meta: { label } });
    res.status(201).json(ok({ categories }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function removeCategory(req, res, next) {
  try {
    const name = req.query?.name || req.body?.name;
    if (!name) return res.status(400).json(fail('INVALID', 'Category name required'));
    const categories = await svc.removeCategory(name);
    await audit({ actor: req.user._id, action: 'visitor.category.remove', entityType: 'Setting', entityId: 'global', meta: { name } });
    res.json(ok({ categories }));
  } catch (err) {
    handleErr(res, err, next);
  }
}
