import { ok, fail } from '../lib/apiResponse.js';
import { RuleSection } from '../models/RuleSection.js';
import { Setting } from '../models/Setting.js';
import { audit } from '../models/AuditLog.js';
import { isOwnerRole } from '../lib/roles.js';
import { effectiveSchedule } from '../lib/schedule.js';
import { LeaveBalance } from '../models/LeaveBalance.js';
import { quotaForJoiner } from '../services/leave.service.js';
import { currentLeaveYear } from '../lib/leaveYear.js';
import { joinedYMD } from '../lib/joining.js';
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

// Content updates to the DEFAULT rule text after the first seed. The seed runs once and the
// page then belongs to the CEO's edits, so later wording fixes can't ride the seed. This
// applies them by EXACT-matching the old default text — a rule the CEO has since edited (its
// text differs) is left untouched. Version-gated so it runs once per bump.
const RULES_TEXT_VERSION = 6;
const RULE_TEXT_UPDATES = [
  {
    from: 'Every assigned task has a due date. Finish the work and submit it on or before that date.',
    to: 'Every assigned task should carry a due date. Finish the work and submit it on or before that date. A task handed out WITHOUT a due date is outside the points system altogether — it earns nothing and costs nothing, because there is no deadline to be on time against.',
  },
  // 2026-08-24: the per-day overdue drip now skips non-working days.
  {
    from: 'After that, −{overdueDailyPoints} point more is cut EVERY day until the task is done and approved. The longer it sits, the more it costs.',
    to: 'After that, −{overdueDailyPoints} point more is cut every WORKING day until the task is done and approved — Sundays, weekly-offs and holidays are skipped. The longer it sits, the more it costs.',
  },
  // 2026-08-24: month-to-month carry-forward turned OFF — each month stands on its own.
  {
    from: 'A NEGATIVE balance follows you: it carries into the next month and keeps carrying until you clear it. A negative month pays ₹0 — pay is never cut, the deficit just waits.',
    to: 'A NEGATIVE month stays in that month — it does NOT carry into the next month. Every month starts fresh from zero. A negative month simply pays ₹0 — pay is never cut.',
  },
  {
    from: 'A fully punctual week — Monday to Saturday, no unexcused late and no unexplained absence — earns +{streakPoints} points. Sundays, holidays, approved leave and WFH never break the week.',
    to: 'Being on time 6 working days in a row earns +{streakPoints} points — and then the count starts again towards the next 6. A late arrival or an unexplained absence resets the count to 0, and the very next day starts a fresh one. Sundays, holidays, approved leave and WFH neither break the run nor count towards the 6.',
  },
  {
    from: 'Every full hour of overtime earns +{overtimeHourPoints} point(s). Overtime is totalled once for the whole month: full hours pay in full, and a leftover of more than 30 minutes pays half.',
    to: 'Every full hour of overtime earns +{overtimeHourPoints} point(s). Overtime is totalled once for the whole month, not day by day.',
  },
  {
    from: 'Seniors can assign tasks to their team. Only ASSIGNED tasks earn or cut points — your personal to-dos never affect points.',
    to: 'Seniors can assign tasks to their team. Only ASSIGNED tasks earn or cut points — and only if the CEO & President can see the task: they assigned it themselves, or at least one of them is TAGGED on it. If a senior assigns work to a junior WITHOUT tagging a CEO/President, that task earns no points either. Personal to-dos never affect points.',
  },
];
// Rules that did NOT exist when the page was first seeded. The seed runs once, so a brand
// new rule can't ride it — it has to be appended to the section it belongs to. Matched by
// section TITLE and skipped when a rule with the same text is already present, so this adds
// nothing on a freshly-seeded database (where rulesSeed already carries it) and nothing on
// a second run. Same version gate as the text updates above. A section the CEO has renamed
// or removed is simply skipped rather than re-created — the page is theirs.
const RULE_ADDITIONS = [
  {
    section: 'To-Do & Tasks',
    text: 'Hand work to a junior and tag a CEO or President on it: when that task is completed you earn +{assignTaskDonePoints} points — whether it finished on time or late. Handing work out is never penalised. The CEO & President earn this on work they assign too. Applies to work assigned from 1 August 2026.',
  },
  {
    section: 'To-Do & Tasks',
    text: 'Once you have assigned a task, its due date is FINAL — you cannot move it, earlier or later. Only the CEO & President can change a due date. Applies to work assigned from 1 August 2026.',
  },
];

async function migrateRuleText() {
  const s = await Setting.getSingleton();
  if ((s.rulesTextVersion || 0) >= RULES_TEXT_VERSION) return;
  for (const u of RULE_TEXT_UPDATES) {
    // eslint-disable-next-line no-await-in-loop
    await RuleSection.updateMany(
      { 'rules.text': u.from },
      { $set: { 'rules.$[e].text': u.to } },
      { arrayFilters: [{ 'e.text': u.from }] },
    );
  }
  for (const a of RULE_ADDITIONS) {
    // eslint-disable-next-line no-await-in-loop
    const sec = await RuleSection.findOne({ title: a.section });
    if (!sec || (sec.rules || []).some((r) => r.text === a.text)) continue;
    sec.rules.push({ text: a.text });
    // eslint-disable-next-line no-await-in-loop
    await sec.save();
  }
  await Setting.updateOne({ key: 'global' }, { $set: { rulesTextVersion: RULES_TEXT_VERSION } });
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
  // Overtime buffer: when overtime starts, in the viewer's own shift terms — the
  // per-user buffer from effectiveSchedule, NOT the office-wide s.overtimeAfterMinutes.
  // The scorer already uses each person's own buffer (attendance.service), so reading the
  // office one here made the rule book state a start time the points system does not use
  // for anyone on a custom shift — and this same function's own doc comment promises
  // "timings from the VIEWER's own shift".
  const otBuffer = Math.max(0, sched.overtimeAfterMinutes || 0);
  const [weH, weM] = String(sched.workEnd || '0:0').split(':').map(Number);
  const otStartMin = (weH * 60 + (weM || 0) + otBuffer) % 1440;
  const otStart = fmt12(`${String(Math.floor(otStartMin / 60)).padStart(2, '0')}:${String(otStartMin % 60).padStart(2, '0')}`);
  let overtimeAfterNote;
  if (otBuffer <= 0) {
    overtimeAfterNote = `as soon as you work past your end time (${fmt12(sched.workEnd)})`;
  } else {
    const bh = Math.floor(otBuffer / 60);
    const bm = otBuffer % 60;
    const dur = bh && bm ? `${bh}h ${bm}m` : bh ? `${bh} hour${bh > 1 ? 's' : ''}` : `${bm} minutes`;
    overtimeAfterNote = `${dur} after your end time — from ${otStart}`;
  }
  // The rule reads "You get {annualLeaveQuota} paid leaves" — a statement about THIS
  // person, so it must show THEIR real entitlement, not the company default. A post-go-
  // live joiner's quota is pro-rata (13.5, not 18), and a stored balance may have been
  // frozen or manually overridden — the company number matched neither. Read their own
  // balance if one exists (findOne, never getOrCreate — viewing the rules must not SEED a
  // balance row, the exact GET side effect the leave module warns against); otherwise the
  // pro-rata figure they would actually be granted.
  const year = currentLeaveYear();
  const bal = await LeaveBalance.findOne({ user: user._id, year }).select('totalQuota').lean();
  const myQuota = bal ? bal.totalQuota : quotaForJoiner(joinedYMD(user), year, s.annualLeaveQuota);

  return {
    workStart: fmt12(sched.workStart),
    workEnd: fmt12(sched.workEnd),
    graceMinutes: grace,
    overtimeAfterMinutes: otBuffer,
    overtimeAfterNote,
    // Reads as part of a sentence — empty when there is no grace, so "after your start
    // time counts as LATE" never says "0 minutes".
    graceNote: grace > 0 ? ` (a ${grace}-minute grace is allowed)` : '',
    annualLeaveQuota: myQuota,
    wfhCap: WFH_YEARLY_CAP,
    // Extra days after a task's due date before it counts late (the bonus grace).
    taskGraceDays: b.graceDays ?? 0,
    rupeesPerPoint: b.rupeesPerPoint || 0,
    onTimePoints: pts('assignedTaskOnTime'),
    latePoints: pts('assignedTaskLate'),
    overdueDailyPoints: pts('assignedTaskOverdueDaily'),
    forwardOnTimePoints: pts('forwardOnTime'),
    forwardLatePoints: pts('forwardLate'),
    assignTaskDonePoints: pts('assignTaskDone'),
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
    await migrateRuleText();
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
