import { ok, fail } from '../lib/apiResponse.js';
import { RuleSection } from '../models/RuleSection.js';
import { Setting } from '../models/Setting.js';
import { audit } from '../models/AuditLog.js';
import { isOwnerRole } from '../lib/roles.js';
import { effectiveSchedule } from '../lib/schedule.js';
import { WFH_YEARLY_CAP } from '../services/leave.service.js';
import { DEFAULT_RULE_SECTIONS } from '../lib/rulesSeed.js';

/** Only the owner tier (CEO & President) may change the rules; everyone reads them. */
export function requireOwner(req, res, next) {
  if (!isOwnerRole(req.user?.role)) {
    return res.status(403).json(fail('FORBIDDEN', 'Only the CEO & President can change the rules'));
  }
  return next();
}

/**
 * Seed the starting rules exactly once. The flag flip is atomic (findOneAndUpdate on
 * rulesSeeded !== true), so two Lambdas hitting the page at the same moment can't both
 * insert — only the winner seeds. After this, the page belongs to the CEO's edits; a
 * deliberately emptied page stays empty.
 */
async function ensureSeeded() {
  const s = await Setting.getSingleton();
  if (s.rulesSeeded) return;
  const won = await Setting.findOneAndUpdate({ key: 'global', rulesSeeded: { $ne: true } }, { $set: { rulesSeeded: true } });
  if (won) {
    await RuleSection.insertMany(DEFAULT_RULE_SECTIONS.map((sec, i) => ({ ...sec, order: i })));
  }
  Setting.invalidateCache();
}

/** 'HH:mm' → '10:00 AM' — timings read naturally on the page. */
function fmt12(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return hhmm || '';
  let h = Number(m[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${suffix}`;
}

/**
 * The live values {placeholders} resolve to — timings from the VIEWER's own shift, every
 * point value from the current bonus settings (absolute numbers; the text carries the +/−
 * wording). This is what keeps the page true after any Settings change.
 */
async function ruleTokens(user) {
  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  const sched = effectiveSchedule(user, s);
  const pts = (key) => Math.abs(Number((b.autoRules || []).find((r) => r.key === key)?.points) || 0);
  const grace = sched.graceMinutes ?? 0;
  return {
    workStart: fmt12(sched.workStart),
    workEnd: fmt12(sched.workEnd),
    graceMinutes: grace,
    // Reads as part of a sentence — empty when there is no grace, so "after your start
    // time counts as LATE" never says "0 minutes".
    graceNote: grace > 0 ? ` (a ${grace}-minute grace is allowed)` : '',
    annualLeaveQuota: s.annualLeaveQuota,
    wfhCap: WFH_YEARLY_CAP,
    // Extra days after a task's due date before it counts late (the bonus grace).
    taskGraceDays: b.graceDays ?? 0,
    rupeesPerPoint: b.rupeesPerPoint || 0,
    onTimePoints: pts('assignedTaskOnTime'),
    latePoints: pts('assignedTaskLate'),
    overdueDailyPoints: pts('assignedTaskOverdueDaily'),
    forwardOnTimePoints: pts('forwardOnTime'),
    forwardLatePoints: pts('forwardLate'),
    streakPoints: pts('punctualStreak'),
    lateArrivalPoints: pts('lateArrival'),
    overtimeHourPoints: pts('overtimeHour'),
    absentPoints: pts('absentDay'),
    noLeavePoints: pts('noLeaveMonth'),
    perfectMonthPoints: pts('perfectAttendanceMonth'),
  };
}

function resolveText(text, tokens) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (tokens[k] !== undefined ? String(tokens[k]) : m));
}

/** Everyone: the whole rule book, sections in order, placeholders resolved for THIS viewer. */
export async function list(req, res, next) {
  try {
    await ensureSeeded();
    const tokens = await ruleTokens(req.user);
    const sections = await RuleSection.find().sort({ order: 1, createdAt: 1 });
    const canManage = isOwnerRole(req.user.role);
    res.json(
      ok({
        canManage,
        // The editor shows these live values beside each placeholder; harmless to send to
        // everyone (they're the same numbers the rules themselves display).
        tokens,
        sections: sections.map((sec) => {
          const j = sec.toJSON();
          return { ...j, rules: j.rules.map((r) => ({ id: r.id, text: resolveText(r.text, tokens), raw: r.text })) };
        }),
      }),
    );
  } catch (err) {
    next(err);
  }
}

const cleanTitle = (v) => String(v ?? '').trim().slice(0, 80);
const cleanIcon = (v) => String(v ?? '').trim().slice(0, 40);
const cleanText = (v) => String(v ?? '').trim().slice(0, 600);

export async function createSection(req, res, next) {
  try {
    const title = cleanTitle(req.body?.title);
    if (!title) return res.status(400).json(fail('NO_TITLE', 'Give the section a title'));
    const last = await RuleSection.findOne().sort({ order: -1 }).select('order');
    const section = await RuleSection.create({ title, icon: cleanIcon(req.body?.icon) || 'BookOpen', order: (last?.order ?? -1) + 1 });
    await audit({ actor: req.user._id, action: 'rules.section.create', entityType: 'RuleSection', entityId: String(section._id), meta: { title } });
    res.json(ok({ section: section.toJSON() }));
  } catch (err) {
    next(err);
  }
}

export async function updateSection(req, res, next) {
  try {
    const section = await RuleSection.findById(req.params.id);
    if (!section) return res.status(404).json(fail('NOT_FOUND', 'Section not found'));
    if (req.body?.title !== undefined) {
      const title = cleanTitle(req.body.title);
      if (!title) return res.status(400).json(fail('NO_TITLE', 'Give the section a title'));
      section.title = title;
    }
    if (req.body?.icon !== undefined) section.icon = cleanIcon(req.body.icon) || 'BookOpen';
    await section.save();
    await audit({ actor: req.user._id, action: 'rules.section.update', entityType: 'RuleSection', entityId: String(section._id), meta: { title: section.title } });
    res.json(ok({ section: section.toJSON() }));
  } catch (err) {
    next(err);
  }
}

export async function removeSection(req, res, next) {
  try {
    const section = await RuleSection.findByIdAndDelete(req.params.id);
    if (!section) return res.status(404).json(fail('NOT_FOUND', 'Section not found'));
    await audit({ actor: req.user._id, action: 'rules.section.delete', entityType: 'RuleSection', entityId: String(section._id), meta: { title: section.title } });
    res.json(ok({ deleted: true }));
  } catch (err) {
    next(err);
  }
}

export async function addRule(req, res, next) {
  try {
    const text = cleanText(req.body?.text);
    if (!text) return res.status(400).json(fail('NO_TEXT', 'Write the rule first'));
    const section = await RuleSection.findById(req.params.id);
    if (!section) return res.status(404).json(fail('NOT_FOUND', 'Section not found'));
    section.rules.push({ text });
    await section.save();
    await audit({ actor: req.user._id, action: 'rules.rule.add', entityType: 'RuleSection', entityId: String(section._id), meta: { text: text.slice(0, 140) } });
    res.json(ok({ section: section.toJSON() }));
  } catch (err) {
    next(err);
  }
}

export async function updateRule(req, res, next) {
  try {
    const text = cleanText(req.body?.text);
    if (!text) return res.status(400).json(fail('NO_TEXT', 'Write the rule first'));
    const section = await RuleSection.findById(req.params.id);
    if (!section) return res.status(404).json(fail('NOT_FOUND', 'Section not found'));
    const rule = section.rules.id(req.params.ruleId);
    if (!rule) return res.status(404).json(fail('NOT_FOUND', 'Rule not found'));
    rule.text = text;
    await section.save();
    await audit({ actor: req.user._id, action: 'rules.rule.update', entityType: 'RuleSection', entityId: String(section._id), meta: { text: text.slice(0, 140) } });
    res.json(ok({ section: section.toJSON() }));
  } catch (err) {
    next(err);
  }
}

export async function removeRule(req, res, next) {
  try {
    const section = await RuleSection.findById(req.params.id);
    if (!section) return res.status(404).json(fail('NOT_FOUND', 'Section not found'));
    const rule = section.rules.id(req.params.ruleId);
    if (!rule) return res.status(404).json(fail('NOT_FOUND', 'Rule not found'));
    rule.deleteOne();
    await section.save();
    await audit({ actor: req.user._id, action: 'rules.rule.delete', entityType: 'RuleSection', entityId: String(section._id) });
    res.json(ok({ section: section.toJSON() }));
  } catch (err) {
    next(err);
  }
}
