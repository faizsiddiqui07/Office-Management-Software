import { ok, fail } from '../lib/apiResponse.js';
import { ymdInTz } from '../lib/time.js';
import { can } from '../lib/permissions.js';
import { loadCompanyLogo } from '../lib/brand.js';
import { buildReport, buildSelfReport } from '../services/report.service.js';
import { renderReportToStream, renderSelfReportToStream } from '../services/reportPdf.service.js';
import { audit } from '../models/AuditLog.js';

const TYPES = ['daily', 'weekly', 'monthly', 'yearly', 'custom'];
const COMPANY_SECTIONS = ['attendance', 'leaves', 'expenses', 'roster', 'dues'];
const SELF_SECTIONS = ['attendance', 'leaves', 'dues'];

const isYMD = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function dateOrToday(query) {
  return isYMD(query.date) ? query.date : ymdInTz(new Date());
}

/** The from/to window for a `type=custom` report (ignored by the other types). */
function rangeOf(query) {
  return { from: isYMD(query.from) ? query.from : undefined, to: isYMD(query.to) ? query.to : undefined };
}

function typeOrMonthly(query) {
  return TYPES.includes(query.type) ? query.type : 'monthly';
}

function parseSections(raw, allowed) {
  if (typeof raw === 'string' && raw.length) {
    const picked = raw.split(',').filter((s) => allowed.includes(s));
    if (picked.length) return picked;
  }
  return allowed;
}

function periodFilename(prefix, type, period) {
  const f = period.from;
  if (type === 'monthly') return `${prefix}-${f.slice(0, 7)}.pdf`;
  if (type === 'yearly') return `${prefix}-${f.slice(0, 4)}.pdf`;
  if (type === 'weekly') return `${prefix}-week-${f}.pdf`;
  return `${prefix}-${f}.pdf`;
}

/**
 * Which company report sections a user may see. The company report is for
 * LEADERSHIP who can see everyone's data — i.e. roles with BOTH the leadership
 * dashboard and view-everyone access (CEO & President and Executive Management
 * here). Everyone else gets only their own (self) report, never the company one.
 */
function sectionAccess(user) {
  const all = can(user, 'leadershipDashboard') && can(user, 'viewEveryone');
  return { attendance: all, leaves: all, roster: all, expenses: all, dues: all };
}

export function canCompanyReports(user) {
  return Object.values(sectionAccess(user)).some(Boolean);
}

/** Express gate: must be able to see at least one company report section. */
export function requireCompanyReports(req, res, next) {
  if (!canCompanyReports(req.user)) {
    return res.status(403).json(fail('FORBIDDEN', 'You don’t have access to company reports'));
  }
  return next();
}

// ── Company reports ──────────────────────────────────────────

export async function preview(req, res, next) {
  try {
    if (!TYPES.includes(req.params.type)) return res.status(400).json(fail('BAD_TYPE', 'Invalid report type'));
    const access = sectionAccess(req.user);
    const data = await buildReport(req.params.type, dateOrToday(req.query), rangeOf(req.query));
    // Strip sections the user may not see.
    if (!access.expenses) delete data.expenses;
    if (!access.dues) delete data.dues;
    if (!access.attendance) {
      delete data.attendance;
      delete data.leaves;
      delete data.roster;
    }
    data.allowedSections = COMPANY_SECTIONS.filter((s) => access[s]);
    return res.json(ok(data));
  } catch (err) {
    return next(err);
  }
}

export async function download(req, res, next) {
  try {
    const { type } = req.params;
    if (!TYPES.includes(type)) return res.status(400).json(fail('BAD_TYPE', 'Invalid report type'));

    const access = sectionAccess(req.user);
    const requested = parseSections(req.query.sections, COMPANY_SECTIONS);
    const sections = requested.filter((s) => access[s]);
    if (!sections.length) return res.status(403).json(fail('FORBIDDEN', 'No permitted sections to include'));

    const date = dateOrToday(req.query);
    const data = await buildReport(type, date, rangeOf(req.query));
    await audit({ actor: req.user._id, action: 'report.download', entityType: 'Report', entityId: type, meta: { scope: 'company', date, sections } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${periodFilename(`${type}-report`, type, data.period)}"`);

    const stream = await renderReportToStream(data, sections, loadCompanyLogo(data.company.logoDark || data.company.logoUrl || data.company.logoLight));
    stream.on('error', (err) => next(err));
    stream.pipe(res);
    return undefined;
  } catch (err) {
    return next(err);
  }
}

// ── Self-service reports (your own data, any role) ───────────

export async function selfPreview(req, res, next) {
  try {
    const data = await buildSelfReport({ user: req.user, type: typeOrMonthly(req.query), dateYMD: dateOrToday(req.query), range: rangeOf(req.query) });
    return res.json(ok(data));
  } catch (err) {
    return next(err);
  }
}

export async function selfDownload(req, res, next) {
  try {
    const type = typeOrMonthly(req.query);
    const date = dateOrToday(req.query);
    const sections = parseSections(req.query.sections, SELF_SECTIONS);

    const data = await buildSelfReport({ user: req.user, type, dateYMD: date, range: rangeOf(req.query) });
    await audit({ actor: req.user._id, action: 'report.download', entityType: 'Report', entityId: 'me', meta: { scope: 'me', type, date, sections } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${periodFilename('my-report', type, data.period)}"`);

    const stream = await renderSelfReportToStream(data, sections, loadCompanyLogo(data.company.logoDark || data.company.logoUrl || data.company.logoLight));
    stream.on('error', (err) => next(err));
    stream.pipe(res);
    return undefined;
  } catch (err) {
    return next(err);
  }
}
