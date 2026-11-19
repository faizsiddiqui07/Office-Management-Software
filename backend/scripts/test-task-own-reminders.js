/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * TO-DO ME "YAAD DILANA" KA WAQT (idea I43, owner ka faisla 19 Nov 2026).
 *
 * Owner ne jo chuna:
 *   • Yaad ka waqt: taiyaar option + apna waqt, ek din me ZYADA SE ZYADA 3
 *   • Yaad DUE WALE DIN jaati hai; chaaho to ek din pehle bhi, unhi waqton par
 *   • Yaad SIRF us bande ko jiska kaam hai (dene wale ko nahi — use overdue wali
 *     alag ghanti pehle se milti hai)
 *   • Kaam DETE waqt bhi set ho sakti hai, sirf personal task me nahi
 *
 * REPEAT yahan NAHI hai: 19 Nov 2026 ko owner ne use hata diya ("wo chahiye hi nahi").
 * Section M me ek check isi baat ka hai — `repeat` key bheji bhi jaye to ab kuch nahi
 * hota, task saadha banta hai.
 *
 * Koi NAKLI GHADI nahi: runOwnReminders(now) khud `now` leta hai.
 * (18 Nov ko seekha — globalThis.Date badalne se Mongoose ka connection-hisab bigadta
 * hai; dekho memory isolated-db-testing.)
 *
 * Run (backend folder se):  node scripts/test-task-own-reminders.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_taskremind'; // throwaway DB
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
import { runOwnReminders } from '../src/services/taskReminder.service.js';
import * as tasks from '../src/services/task.service.js';

const DB = 'office_test_taskremind';
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

  await section('L — jisko kaam mila: apni yaad badal sake, baaki kuch nahi', async () => {
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
    const t = await mkTask({ title: 'Khaan ka diya', dueYMD: TODAY, assignedBy: khaan._id, remindTimes: [] });
    await tasks.updateTask(anjali, String(t._id), { remindTimes: ['08:30', '16:00'], remindDayBefore: true });
    let after = await Task.findById(t._id).lean();
    check('apna waqt lag gaya', same(after.remindTimes, ['08:30', '16:00']) && after.remindDayBefore === true, JSON.stringify(after.remindTimes));
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

  await section('M — teen se zyada waqt nahi', async () => {
    await Task.deleteMany({});
    const { tasks: made } = await tasks.createTask(anjali, { title: 'Chaar waqt', dueYMD: TODAY, remindTimes: ['09:00', '10:00', '11:00', '12:00'] });
    check('chauthe waqt ki katai ho gayi (3 bache)', made[0].remindTimes.length === 3, JSON.stringify(made[0].remindTimes));
    const { tasks: assigned } = await tasks.createTask(khaan, { title: 'Dete waqt hi set', assignTo: String(anjali._id), dueYMD: TODAY, remindTimes: ['07:45'] });
    check('kaam dete waqt hi yaad lag gayi', same(assigned[0].remindTimes, ['07:45']), JSON.stringify(assigned[0].remindTimes));
    // Repeat 19 Nov 2026 ko HATA diya gaya (owner: "wo chahiye hi nahi") — ab wo key
    // bheji bhi jaye to validator use chup-chaap gira deta hai, task banta rehta hai.
    const { tasks: noRepeat } = await tasks.createTask(anjali, { title: 'Repeat ab nahi', dueYMD: TODAY, repeat: { type: 'DAILY' } });
    check('repeat key ab bemaani hai — task banta hai, repeat kahin nahi', noRepeat[0].repeat === undefined, JSON.stringify(noRepeat[0].repeat));
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
