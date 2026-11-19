/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * TO-DO ME "YAAD DILANA" KA WAQT AUR REPEAT (idea I43, owner ka faisla 19 Nov 2026).
 *
 * Owner ne jo chuna:
 *   • Yaad ka waqt: taiyaar option + apna waqt, ek din me ZYADA SE ZYADA 3
 *   • Yaad SIRF us bande ko jiska kaam hai (dene wale ko nahi — use overdue wali
 *     alag ghanti pehle se milti hai)
 *   • Repeat personal AUR diye hue, DONO par; aur dono log set kar sakte hain
 *   • Repeat ke option: Roz / har hafte (kai din) / har mahine (kai tareekh)
 *     + chuni hui taarikhein
 *
 * Koi NAKLI GHADI nahi: runOwnReminders(now) khud `now` leta hai.
 * (18 Nov ko seekha — globalThis.Date badalne se Mongoose ka connection-hisab bigadta
 * hai; dekho memory isolated-db-testing.)
 *
 * Run (backend folder se):  node scripts/test-task-repeat-reminders.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_taskrepeat'; // throwaway DB
process.env.VAPID_PUBLIC_KEY = 'test-public'; // nakli — web-push neeche stub hai
process.env.VAPID_PRIVATE_KEY = 'test-private';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Role } from '../src/models/Role.js';
import { User } from '../src/models/User.js';
import { Setting } from '../src/models/Setting.js';
import { Task } from '../src/models/Task.js';
import { Notification } from '../src/models/Notification.js';
import { NudgeLog } from '../src/models/NudgeLog.js';
import { PushSubscription } from '../src/models/PushSubscription.js';
import { loadRoles } from '../src/lib/roles.js';
import { SYSTEM_ROLES } from '../src/lib/permissionCatalog.js';
import { ymdInTz, companyDayFromYMD } from '../src/lib/time.js';
import { addDays } from '../src/services/bonus.service.js';
import { nextTaskDueYMD, describeTaskRepeat, repeatBlockedReason } from '../src/lib/taskRepeat.js';
import { runOwnReminders } from '../src/services/taskReminder.service.js';
import * as tasks from '../src/services/task.service.js';

const DB = 'office_test_taskrepeat';
let failures = 0;
let total = 0;
function check(name, cond, extra = '') {
  total += 1;
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function section(title, fn) {
  console.log(`\n${title}`);
  try { await Notification.deleteMany({}); await fn(); } catch (e) { check(`${title} — crash`, false, e?.stack || e?.message); }
}

async function stubWebPush() {
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails = () => {};
  webpush.sendNotification = async () => {};
}

const nameOf = new Map();
const who = async (filter = {}) => (await Notification.find(filter).select('user').lean()).map((r) => nameOf.get(String(r.user))).sort();
const count = (filter = {}) => Notification.countDocuments(filter);
/** Aaj ke company-din par ek waqt. */
const todayAt = (hm) => {
  const [h, m] = hm.split(':').map(Number);
  return new Date(companyDayFromYMD(ymdInTz(new Date())).getTime() + (h * 60 + m) * 60000);
};

async function main() {
  await connectDB();
  if (!/test/i.test(mongoose.connection.name || '')) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${mongoose.connection.name}`);

  const LEAD = SYSTEM_ROLES.find((r) => r.key === 'CEO').permissions;
  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO & President', rank: 1, permissions: LEAD },
    { key: 'TEAM', label: 'Team', rank: 10, permissions: ['markAttendance', 'applyLeave'] },
  ]);
  await loadRoles();
  await Setting.create({ key: 'global', companyName: 'TestCo', weekendDays: [], rolesSchemaVersion: 2, bonus: { enabled: false } });
  Setting.invalidateCache();

  const mk = async (name, role, extra = {}) => {
    const tag = name.replace(/\W+/g, '').toLowerCase();
    const u = await User.create({ name, email: `${tag}@t.co`, passwordHash: 'x', role, employeeId: `TR-${tag}`, isActive: true, dateOfJoining: new Date('2026-06-01T00:00:00+05:30'), taskAssign: { mode: 'ALL', users: [] }, ...extra });
    nameOf.set(String(u._id), name);
    await PushSubscription.create({ user: u._id, endpoint: `https://push.test/${tag}`, keys: { p256dh: 'k', auth: 'a' } });
    return u;
  };
  const khaan = await mk('Khaan Aamir', 'CEO_PRESIDENT');
  const anjali = await mk('Anjali Singh', 'TEAM');
  const gone = await mk('Chhoda Hua', 'TEAM', { isActive: false });
  await stubWebPush();

  const TODAY = ymdInTz(new Date());
  const TOMORROW = addDays(TODAY, 1);
  const mkTask = (o) => Task.create({ status: 'PENDING', title: 'x', owner: anjali._id, assignedBy: null, collaborators: [], ...o });

  // ─────────────────────────── A — hisaab (koi DB nahi) ───────────────────────────
  await section('A — agli taarikh ka hisaab', async () => {
    check('Roz: 20 Nov → 21 Nov', nextTaskDueYMD({ type: 'DAILY' }, '2026-11-20') === '2026-11-21');
    // 20 Nov 2026 = Friday. Agla Som = 23, agla Budh = 25.
    check('Har hafte Som+Budh: Shukr 20 Nov → Som 23 Nov', nextTaskDueYMD({ type: 'WEEKLY', weekdays: [1, 3] }, '2026-11-20') === '2026-11-23');
    check('…aur 23 se agla → Budh 25', nextTaskDueYMD({ type: 'WEEKLY', weekdays: [1, 3] }, '2026-11-23') === '2026-11-25');
    check('Har mahine 5+20: 20 Nov → 5 Dec', nextTaskDueYMD({ type: 'MONTHLY', daysOfMonth: [5, 20] }, '2026-11-20') === '2026-12-05');
    check('…aur 5 Dec se agla → 20 Dec', nextTaskDueYMD({ type: 'MONTHLY', daysOfMonth: [5, 20] }, '2026-12-05') === '2026-12-20');
    // 31 wala clamp — recurrence.js ka tested hisaab.
    check('Har mahine 31: 31 Jan → 28 Feb (chhota mahina clamp)', nextTaskDueYMD({ type: 'MONTHLY', daysOfMonth: [31] }, '2027-01-31') === '2027-02-28');
    check('Chuni hui taarikhein: 20 Nov → 25 Dec', nextTaskDueYMD({ type: 'DATES', dates: ['2026-12-25', '2026-11-05'] }, '2026-11-20') === '2026-12-25');
    check('…saari taarikhein guzar gayi → null (kaam bas khatam)', nextTaskDueYMD({ type: 'DATES', dates: ['2026-01-01'] }, '2026-11-20') === null);
    check('Adhoora rule (WEEKLY par koi din nahi) → null', nextTaskDueYMD({ type: 'WEEKLY', weekdays: [] }, '2026-11-20') === null);
    check('text: Roz / har hafte / har mahine', describeTaskRepeat({ type: 'DAILY' }) === 'Every day'
      && describeTaskRepeat({ type: 'WEEKLY', weekdays: [3, 1] }) === 'Every Mon, Wed'
      && describeTaskRepeat({ type: 'MONTHLY', daysOfMonth: [20, 5] }) === 'Monthly on 5, 20');
  });

  // ─────────────────────────── B — yaad dilana ───────────────────────────
  await section('B — yaad ka waqt: subah 9 baje kuch nahi, 10:05 par ghanti', async () => {
    const t = await mkTask({ title: 'Vendor ko call', dueYMD: TODAY, remindTimes: ['10:00'] });
    let r = await runOwnReminders(todayAt('09:00'));
    check('09:00 — waqt nahi aaya', r.sent === 0 && (await count()) === 0, JSON.stringify(r));
    r = await runOwnReminders(todayAt('10:05'));
    check('10:05 — ek ghanti gayi', r.sent === 1, JSON.stringify(r));
    check('sirf Anjali ko', same(await who(), ['Anjali Singh']), JSON.stringify(await who()));
    const row = await Notification.findOne().lean();
    check('type TASK_REMINDER', row?.type === 'TASK_REMINDER', row?.type);
    check('title kaam ka naam, message "Reminder · due today"', row?.title === 'Vendor ko call' && row?.message === 'Reminder · due today', `${row?.title} | ${row?.message}`);
    check('link seedha usi task par', row?.link === `/todo?task=${t._id}`, row?.link);
    check('tag TaskDue (deadline wali ghanti ke saath ek hi jagah)', row?.entityType === 'TaskDue');
    await Notification.deleteMany({});
    r = await runOwnReminders(todayAt('10:30'));
    check('usi din dobara nahi (claim)', r.sent === 0 && (await count()) === 0);
  });

  await section('C — ek hi din me teen waqt (owner ki hadd)', async () => {
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
    await mkTask({ title: 'Teen baar', dueYMD: TODAY, remindTimes: ['09:00', '13:00', '17:00'] });
    let r = await runOwnReminders(todayAt('09:05'));
    check('subah 9 — pehli', r.sent === 1, JSON.stringify(r));
    r = await runOwnReminders(todayAt('13:05'));
    check('dopahar 1 — doosri', r.sent === 1, JSON.stringify(r));
    r = await runOwnReminders(todayAt('17:05'));
    check('shaam 5 — teesri', r.sent === 1, JSON.stringify(r));
    check('kul teen ghanti, teeno Anjali ko', (await count()) === 3 && same(await who(), ['Anjali Singh', 'Anjali Singh', 'Anjali Singh']));
    r = await runOwnReminders(todayAt('18:00'));
    check('uske baad kuch nahi', r.sent === 0);
  });

  await section('D — ek din pehle wala', async () => {
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
    await mkTask({ title: 'Kal due, pehle yaad', dueYMD: TOMORROW, remindTimes: ['10:00'], remindDayBefore: true });
    await mkTask({ title: 'Kal due, pehle yaad NAHI', dueYMD: TOMORROW, remindTimes: ['10:00'], remindDayBefore: false });
    const r = await runOwnReminders(todayAt('10:05'));
    check('sirf us task ki jispar "ek din pehle" chaalu hai', r.sent === 1, JSON.stringify(r));
    const row = await Notification.findOne().lean();
    check('message me saaf ki kal due hai', row?.message === 'Reminder · due tomorrow · due tomorrow — a day to go', row?.message);
  });

  await section('E — jin par ghanti NAHI jaani chahiye', async () => {
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
    await mkTask({ title: 'Ho chuka', dueYMD: TODAY, remindTimes: ['10:00'], status: 'DONE', completedAt: new Date() });
    await mkTask({ title: 'Submit ho chuka', dueYMD: TODAY, remindTimes: ['10:00'], assignedBy: khaan._id, requiresApproval: true, submittedAt: new Date() });
    await mkTask({ title: 'Koi waqt hi nahi', dueYMD: TODAY, remindTimes: [] });
    await mkTask({ title: 'Parson due', dueYMD: addDays(TODAY, 2), remindTimes: ['10:00'], remindDayBefore: true });
    const r = await runOwnReminders(todayAt('10:05'));
    check('chaaron par kuch nahi', r.sent === 0 && (await count()) === 0, JSON.stringify(r));
  });

  await section('F — diya hua kaam: ghanti SIRF karne wale ko, dene wale ko nahi', async () => {
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
    await mkTask({ title: 'Khaan ka diya kaam', dueYMD: TODAY, remindTimes: ['10:00'], assignedBy: khaan._id });
    await runOwnReminders(todayAt('10:05'));
    check('sirf Anjali ko (Khaan ko nahi)', same(await who(), ['Anjali Singh']), JSON.stringify(await who()));
  });

  // ─────────────────────────── G — repeat ───────────────────────────
  await section('G — personal roz wala: poora hote hi agla copy', async () => {
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
    const t = await mkTask({ title: 'Roz ka kaam', dueYMD: TODAY, remindTimes: ['09:00'], remindDayBefore: true, repeat: { type: 'DAILY' } });
    await tasks.setStatus(anjali, String(t._id), 'DONE');
    const fresh = await Task.find({ title: 'Roz ka kaam' }).sort({ createdAt: 1 }).lean();
    check('do copy ho gaye', fresh.length === 2, String(fresh.length));
    check('purana DONE, naya PENDING', fresh[0].status === 'DONE' && fresh[1].status === 'PENDING');
    check('nayi due date = kal', fresh[1].dueYMD === TOMORROW, fresh[1].dueYMD);
    check('yaad ka waqt saath aaya', same(fresh[1].remindTimes, ['09:00']) && fresh[1].remindDayBefore === true);
    check('repeat bhi saath aaya', fresh[1].repeat?.type === 'DAILY');
    check('purane par "ban chuka" ka nishaan', fresh[0].repeatSpawned === true);
    check('naye par nishaan nahi (uski apni baari aayegi)', fresh[1].repeatSpawned === false);
    check('karne wale ko khabar gayi', same(await who({ type: 'TASK_ASSIGNED' }), ['Anjali Singh']));
  });

  await section('H — done → undo → done: sirf EK copy bane', async () => {
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
    const t = await mkTask({ title: 'Ek hi baar', dueYMD: TODAY, repeat: { type: 'DAILY' } });
    await tasks.setStatus(anjali, String(t._id), 'DONE');
    await tasks.setStatus(anjali, String(t._id), 'PENDING');
    await tasks.setStatus(anjali, String(t._id), 'DONE');
    check('kul do hi copy (teen nahi)', (await Task.countDocuments({ title: 'Ek hi baar' })) === 2, String(await Task.countDocuments({ title: 'Ek hi baar' })));
  });

  await section('I — diye hue kaam ka repeat: naya copy usi ke naam, dene wala wahi', async () => {
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
    const t = await mkTask({ title: 'Har Som report', dueYMD: TODAY, assignedBy: khaan._id, repeat: { type: 'DAILY' }, remindTimes: ['11:00'] });
    await tasks.setStatus(anjali, String(t._id), 'DONE');
    const next = await Task.findOne({ title: 'Har Som report', status: 'PENDING' }).lean();
    check('naya copy bana', !!next);
    check('karne wala wahi', String(next?.owner) === String(anjali._id));
    check('dene wala bhi wahi', String(next?.assignedBy) === String(khaan._id));
    check('yaad ka waqt saath', same(next?.remindTimes, ['11:00']));
    check('batch khaali (nayi baari ki apni ginti nahi)', !next?.assignBatch);
    const msg = (await Notification.findOne({ type: 'TASK_ASSIGNED' }).lean())?.message;
    check('karne wale ko "wapas aaya" wali khabar', /Back again/.test(msg || ''), msg);
  });

  await section('J — approval wala: SUBMIT par copy nahi, APPROVE par bane', async () => {
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
    const t = await mkTask({ title: 'Approval wala repeat', dueYMD: TODAY, assignedBy: khaan._id, requiresApproval: true, repeat: { type: 'DAILY' } });
    await tasks.setStatus(anjali, String(t._id), 'DONE'); // = submit
    check('submit par naya copy NAHI bana', (await Task.countDocuments({ title: 'Approval wala repeat' })) === 1);
    await tasks.reviewTask(khaan, String(t._id), true, '');
    check('approve par bana', (await Task.countDocuments({ title: 'Approval wala repeat' })) === 2);
  });

  await section('K — jab repeat NAHI chalna chahiye', async () => {
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
    // (1) aage pass ki hui copy
    const parent = await mkTask({ title: 'Parent', dueYMD: TODAY, assignedBy: khaan._id, repeat: { type: 'DAILY' } });
    const child = await mkTask({ title: 'Forwarded copy', dueYMD: TODAY, assignedBy: anjali._id, forwardedFrom: parent._id, repeat: { type: 'DAILY' } });
    check('forwarded copy par wajah "forwarded-copy"', repeatBlockedReason(child) === 'forwarded-copy', repeatBlockedReason(child));
    // (2) karne wala ab active nahi
    const t2 = await mkTask({ title: 'Chhode hue banda', dueYMD: TODAY, owner: gone._id, repeat: { type: 'DAILY' } });
    await tasks.setStatus(gone, String(t2._id), 'DONE');
    check('inactive bande ka kaam dobara nahi banta', (await Task.countDocuments({ title: 'Chhode hue banda' })) === 1);
    // (3) dene wale ka account hi nahi raha
    const t3 = await mkTask({ title: 'Assigner hata diya', dueYMD: TODAY, assignedBy: null, assignerDeleted: true, repeat: { type: 'DAILY' } });
    check('assignerDeleted par wajah saaf', repeatBlockedReason(t3) === 'assigner-deleted', repeatBlockedReason(t3));
    // (4) bina due date
    const t4 = await mkTask({ title: 'Bina date', dueYMD: '', repeat: { type: 'DAILY' } });
    check('bina due date par wajah saaf', repeatBlockedReason(t4) === 'no-due-date', repeatBlockedReason(t4));
  });

  // ─────────────────────────── L — kaun kya badal sakta hai ───────────────────────────
  await section('L — jisko kaam mila: apni yaad badal sake, baaki kuch nahi', async () => {
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
    const t = await mkTask({ title: 'Khaan ka diya', dueYMD: TODAY, assignedBy: khaan._id, remindTimes: [] });
    await tasks.updateTask(anjali, String(t._id), { remindTimes: ['08:30', '16:00'], remindDayBefore: true });
    let after = await Task.findById(t._id).lean();
    check('apna waqt lag gaya', same(after.remindTimes, ['08:30', '16:00']) && after.remindDayBefore === true, JSON.stringify(after.remindTimes));
    await tasks.updateTask(anjali, String(t._id), { repeat: { type: 'WEEKLY', weekdays: [1] } });
    after = await Task.findById(t._id).lean();
    check('repeat bhi laga saka (owner ka faisla: dono log)', after.repeat?.type === 'WEEKLY' && same(after.repeat.weekdays, [1]));
    // Sirf naam badalna — purana raasta, purana error. (Ye code frontend aur
    // test-due-date-edit dono padhte hain, isliye waisa ka waisa rehna zaroori hai.)
    let code = null;
    try { await tasks.updateTask(anjali, String(t._id), { title: 'Naam badal diya' }); } catch (e) { code = `${e.status} ${e.code}`; }
    check('sirf naam badalne par purana 403 ASSIGNED_TASK', code === '403 ASSIGNED_TASK', String(code));
    // Yaad ke SAATH naam ghusane ki koshish — tab naya, saaf error.
    code = null;
    try { await tasks.updateTask(anjali, String(t._id), { remindTimes: ['07:00'], title: 'Chori se naam' }); } catch (e) { code = `${e.status} ${e.code}`; }
    check('yaad ke saath naam ghusane par 403 REMINDER_ONLY', code === '403 REMINDER_ONLY', String(code));
    const after2 = await Task.findById(t._id).lean();
    check('…aur naam waisa ka waisa', after2.title === 'Khaan ka diya', after2.title);
    check('…aur wo waqt bhi nahi laga (poora patch gira)', same(after2.remindTimes, ['08:30', '16:00']), JSON.stringify(after2.remindTimes));
  });

  await section('M — teen se zyada waqt nahi, aur bina due date ke repeat nahi', async () => {
    await Task.deleteMany({});
    const { tasks: made } = await tasks.createTask(anjali, { title: 'Chaar waqt', dueYMD: TODAY, remindTimes: ['09:00', '10:00', '11:00', '12:00'] });
    check('chauthe waqt ki katai ho gayi (3 bache)', made[0].remindTimes.length === 3, JSON.stringify(made[0].remindTimes));
    let code = null;
    try { await tasks.createTask(anjali, { title: 'Repeat bina date', dueYMD: '', repeat: { type: 'DAILY' } }); } catch (e) { code = `${e.status} ${e.code}`; }
    check('bina due date ke repeat par 400', code === '400 REPEAT_NEEDS_DUE', String(code));
    const { tasks: assigned } = await tasks.createTask(khaan, { title: 'Dete waqt hi set', assignTo: String(anjali._id), dueYMD: TODAY, remindTimes: ['07:45'], repeat: { type: 'MONTHLY', daysOfMonth: [5, 20] } });
    check('kaam dete waqt hi yaad + repeat lag gaye', same(assigned[0].remindTimes, ['07:45']) && assigned[0].repeat?.type === 'MONTHLY' && same(assigned[0].repeat.daysOfMonth, [5, 20]), JSON.stringify(assigned[0].repeat));
  });
}

main()
  .then(async () => {
    console.log(`\n${failures ? `❌ ${failures} / ${total} FAIL` : `✅ SAB PAAS — ${total} / ${total}`}`);
    if (mongoose.connection.name === DB) await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(failures ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(e);
    if (mongoose.connection.name === DB) await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(1);
  });
