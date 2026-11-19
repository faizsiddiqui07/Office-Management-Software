/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * TASK DEADLINE KI GHANTI — karne wale ko aur dene wale ko (idea I139, owner ka faisla
 * 19 Nov 2026).
 *
 * Pehle task ke liye ek bhi reminder nahi tha. Due date nikal jaati, aadhi raat ka scan
 * −5 ka mark lagata, phir har working day −1 jodta rehta, aur bande ko mahine ke aakhir
 * me Rewards kholne par pata chalta (audit 13 ka F1: ek task akela −29 tak gaya).
 *
 * Ab teen moke: (1) due se ek din pehle 17:00 — karne wale ko, (2) jis din overdue hua
 * 10:00 — karne wale + dene wale + tagged ko, (3) phir har teesre din dene wale ko jodi
 * hui keemat (ledger se, andaza nahi).
 *
 * Koi NAKLI GHADI nahi: `runTaskReminders(now)` khud `now` leta hai. (18 Nov ko seekha —
 * globalThis.Date badalne se Mongoose ka connection-hisab bigadta hai aur suite girti hai;
 * dekho memory isolated-db-testing.)
 *
 * Run (backend folder se):  node scripts/test-task-reminders.js
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
import { PointEntry } from '../src/models/PointEntry.js';
import { Notification } from '../src/models/Notification.js';
import { NudgeLog } from '../src/models/NudgeLog.js';
import { PushSubscription } from '../src/models/PushSubscription.js';
import { loadRoles } from '../src/lib/roles.js';
import { SYSTEM_ROLES } from '../src/lib/permissionCatalog.js';
import { ymdInTz, companyDayFromYMD } from '../src/lib/time.js';
import { addDays } from '../src/services/bonus.service.js';
import { runTaskReminders } from '../src/services/taskReminder.service.js';

const DB = 'office_test_taskremind';
let failures = 0;
let total = 0;
function check(name, cond, extra = '') {
  total += 1;
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let sent = [];
async function stubWebPush() {
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails = () => {};
  webpush.sendNotification = async (sub, body) => { sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body) }); };
}

const nameOf = new Map();
const byEndpoint = new Map();
/** Kisko kya mila — "Naam :: title :: message", sorted. Poora sach ek jagah. */
const inbox = async (filter = {}) => (await Notification.find(filter).lean())
  .map((r) => `${nameOf.get(String(r.user))} :: ${r.title} :: ${r.message}`).sort();
const count = (filter = {}) => Notification.countDocuments(filter);
const pushedTo = () => sent.map((s) => byEndpoint.get(s.endpoint)).sort();

async function section(title, fn) {
  console.log(`\n${title}`);
  try { await Notification.deleteMany({}); sent = []; await fn(); } catch (e) { check(`${title} — crash`, false, e?.stack || e?.message); }
}

/** Aaj ke company-din par ek waqt (company time) — gate jaanchne ke liye. */
const todayAt = (hm) => {
  const t = ymdInTz(new Date());
  // Company TZ ka wahi pal: companyDayFromYMD aadhi raat deta hai, usme ghante-minute jodo.
  const [h, m] = hm.split(':').map(Number);
  return new Date(companyDayFromYMD(t).getTime() + (h * 60 + m) * 60000);
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
  await Setting.create({
    key: 'global', companyName: 'TestCo', weekendDays: [], rolesSchemaVersion: 2,
    bonus: {
      enabled: true,
      rupeesPerPoint: 100,
      graceDays: 0,
      autoRules: [
        { key: 'assignedTaskOnTime', points: 10 },
        { key: 'assignedTaskLate', points: 5 },
        { key: 'assignedTaskOverdueDaily', points: 1 },
      ],
    },
  });
  Setting.invalidateCache();

  const mk = async (name, role) => {
    const tag = name.replace(/\W+/g, '').toLowerCase();
    const u = await User.create({ name, email: `${tag}@t.co`, passwordHash: 'x', role, employeeId: `TR-${tag}`, isActive: true, dateOfJoining: new Date('2026-06-01T00:00:00+05:30') });
    nameOf.set(String(u._id), name);
    const endpoint = `https://push.test/${tag}`;
    await PushSubscription.create({ user: u._id, endpoint, keys: { p256dh: 'k', auth: 'a' } });
    byEndpoint.set(endpoint, name);
    return u;
  };
  const khaan = await mk('Khaan Aamir', 'CEO_PRESIDENT');   // owner-tier → iske diye task par points lagte hain
  const anjali = await mk('Anjali Singh', 'TEAM');
  const priyanshi = await mk('Priyanshi Patel', 'TEAM');
  const mariya = await mk('Mariya Khan', 'TEAM');

  await stubWebPush();

  const TODAY = ymdInTz(new Date());
  const TOMORROW = addDays(TODAY, 1);
  const task = async (o) => Task.create({ status: 'PENDING', ...o });

  await section('TEST 1 — subah 9 baje koi ghanti nahi (dono gate band)', async () => {
    await task({ title: 'Subah wala', owner: anjali._id, assignedBy: khaan._id, dueYMD: TOMORROW });
    const r = await runTaskReminders(todayAt('09:00'));
    check('job ne "too-early" kaha', r?.skipped === 'too-early', JSON.stringify(r));
    check('koi ghanti nahi', (await count()) === 0, String(await count()));
    await Task.deleteMany({});
  });

  await section('TEST 2 — kal due hai, shaam 5 ke baad → sirf karne wale ko, +10 ke saath', async () => {
    const t = await task({ title: 'Vanyara BOQ revise', owner: anjali._id, assignedBy: khaan._id, dueYMD: TOMORROW });
    const r = await runTaskReminders(todayAt('17:05'));
    check('ek yaad gayi', r?.dueSoon === 1, JSON.stringify(r));
    check('sirf Anjali ko, title me kaam ka naam, message me +10',
      same(await inbox(), ['Anjali Singh :: Vanyara BOQ revise :: Due tomorrow · +10 if you finish on time']), JSON.stringify(await inbox()));
    const row = await Notification.findOne().lean();
    check('type TASK_DUE_SOON', row?.type === 'TASK_DUE_SOON', row?.type);
    check('link seedha usi task par', row?.link === `/todo?task=${t._id}`, row?.link);
    check('push ka tag TaskDue — "approve this" wale banner ko nahi hatayega',
      sent.every((s) => s.payload.tag === `TaskDue:${t._id}`), JSON.stringify(sent.map((s) => s.payload.tag)));
    check('phone push bhi Anjali ko', same(pushedTo(), ['Anjali Singh']), JSON.stringify(pushedTo()));
  });

  await section('TEST 3 — wahi tick dobara (scheduler har 5 min chalta hai) → dobara nahi', async () => {
    const r = await runTaskReminders(todayAt('17:30'));
    check('kuch nahi bheja', r?.dueSoon === 0, JSON.stringify(r));
    check('koi nayi ghanti nahi', (await count()) === 0, String(await count()));
  });

  await section('TEST 4 — due date aage badhi → nayi yaad (claim me due date bhi hai)', async () => {
    const t = await Task.findOne({ title: 'Vanyara BOQ revise' });
    t.dueYMD = addDays(TODAY, 5);
    await t.save();
    await runTaskReminders(todayAt('17:35'));
    check('badli hui due date par abhi yaad nahi (kal due nahi hai)', (await count()) === 0, String(await count()));
    t.dueYMD = TOMORROW; // phir kal par laao — nayi key nahi, purani wahi
    await t.save();
    await runTaskReminders(todayAt('17:40'));
    check('wapas usi due date par → purana claim lagta hai, dobara nahi', (await count()) === 0, String(await count()));
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
  });

  await section('TEST 5 — submit ho chuka task → "kal due hai" bekaar hai, nahi jaata', async () => {
    await task({ title: 'Submitted wala', owner: anjali._id, assignedBy: khaan._id, dueYMD: TOMORROW, requiresApproval: true, submittedAt: new Date() });
    await runTaskReminders(todayAt('17:05'));
    check('koi ghanti nahi', (await count()) === 0, String(await count()));
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
  });

  await section('TEST 6 — jis task par points hi nahi lagte → sirf yaad, points ki line nahi', async () => {
    // Assigner TEAM ka hai aur koi owner-tier banda tagged nahi → chainEligible false.
    await task({ title: 'Points-free kaam', owner: anjali._id, assignedBy: priyanshi._id, dueYMD: TOMORROW });
    await runTaskReminders(todayAt('17:05'));
    check('yaad gayi, par "+10" nahi likha',
      same(await inbox(), ['Anjali Singh :: Points-free kaam :: Due tomorrow']), JSON.stringify(await inbox()));
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
  });

  await section('TEST 7 — aaj overdue hua → karne wale ko, dene wale ko, aur tagged ko', async () => {
    const t = await task({ title: 'Site drawing', owner: anjali._id, assignedBy: khaan._id, collaborators: [mariya._id], dueYMD: addDays(TODAY, -1) });
    const r = await runTaskReminders(todayAt('10:05'));
    check('ek task par overdue ki ghanti bani', r?.overdue === 1, JSON.stringify(r));
    check('teenon ko, aur text sahi', same(await inbox(), [
      'Anjali Singh :: Site drawing :: Overdue — −5 applied · −1 more each working day until it\'s done. Finish it now.',
      'Khaan Aamir :: Site drawing :: Mariya Khan: overdue since yesterday · −5 applied'.replace('Mariya Khan', 'Anjali Singh'),
      'Mariya Khan :: Site drawing :: Anjali Singh: overdue since yesterday · −5 applied',
    ]), JSON.stringify(await inbox(), null, 1));
    const mine = await Notification.findOne({ user: anjali._id }).lean();
    check('type TASK_OVERDUE', mine?.type === 'TASK_OVERDUE', mine?.type);
    const boss = await Notification.findOne({ user: khaan._id }).lean();
    check('dene wale ka link "Assigned by me" tab par', boss?.link === `/todo?tab=assigned&task=${t._id}`, boss?.link);
    const tagged = await Notification.findOne({ user: mariya._id }).lean();
    check('tagged bande ka link uske apne tab par', tagged?.link === `/todo?tab=tagged&task=${t._id}`, tagged?.link);
    check('phone push teenon ko', same(pushedTo(), ['Anjali Singh', 'Khaan Aamir', 'Mariya Khan']), JSON.stringify(pushedTo()));
  });

  await section('TEST 8 — agle din (n=1) chup — na karne wale ko, na dene wale ko', async () => {
    const r = await runTaskReminders(todayAt('10:05'));
    check('kuch nahi', r?.overdue === 0 && r?.escalated === 0, JSON.stringify(r));
    check('koi ghanti nahi', (await count()) === 0, String(await count()));
  });

  await section('TEST 9 — teesre overdue din → sirf dene wale ko, ledger ka asli jod', async () => {
    const t = await Task.findOne({ title: 'Site drawing' });
    t.dueYMD = addDays(TODAY, -4); // overdue day = -3, yaani n = 3
    await t.save();
    // Asli ledger: −5 ka mark + teen din ka −1 = −8. Message ko yahi padhna chahiye.
    await PointEntry.create([
      { user: anjali._id, month: TODAY.slice(0, 7), earnedYMD: addDays(TODAY, -3), points: -5, reason: 'Overdue: Site drawing', source: 'auto_task', taskRef: t._id, dedupeKey: `auto_task:${t._id}` },
      { user: anjali._id, month: TODAY.slice(0, 7), earnedYMD: addDays(TODAY, -2), points: -1, reason: 'Still overdue', source: 'auto_task', taskRef: t._id, dedupeKey: `auto_overdue:${t._id}:a` },
      { user: anjali._id, month: TODAY.slice(0, 7), earnedYMD: addDays(TODAY, -1), points: -1, reason: 'Still overdue', source: 'auto_task', taskRef: t._id, dedupeKey: `auto_overdue:${t._id}:b` },
      { user: anjali._id, month: TODAY.slice(0, 7), earnedYMD: TODAY, points: -1, reason: 'Still overdue', source: 'auto_task', taskRef: t._id, dedupeKey: `auto_overdue:${t._id}:c` },
    ]);
    const r = await runTaskReminders(todayAt('10:05'));
    check('escalation gayi', r?.escalated === 1, JSON.stringify(r));
    check('sirf dene wale ko, jod ledger se (−8)', same(await inbox(), [
      'Khaan Aamir :: Site drawing :: Anjali Singh: still not done — 3 days overdue · −8 so far',
    ]), JSON.stringify(await inbox()));
    check('karne wale ko dobara nahi (use pehle din bata diya tha)', (await count({ user: anjali._id })) === 0);
    await Task.deleteMany({}); await NudgeLog.deleteMany({}); await PointEntry.deleteMany({});
  });

  await section('TEST 10 — overdue + approval ka intezaar → karne wale ko sach, approver ko kaam', async () => {
    const t = await task({ title: 'BOQ sheet', owner: anjali._id, assignedBy: khaan._id, dueYMD: addDays(TODAY, -1), requiresApproval: true, submittedAt: new Date() });
    await runTaskReminders(todayAt('10:05'));
    check('dono ko theek baat gayi', same(await inbox(), [
      'Anjali Singh :: BOQ sheet :: Overdue — waiting for approval · −5 applied · −1 more each working day until it\'s done',
      'Khaan Aamir :: BOQ sheet :: Anjali Singh submitted this — your approval is overdue · Anjali Singh loses 1 a working day until you sign it off',
    ]), JSON.stringify(await inbox(), null, 1));
    check('karne wale ko "submit karo" NAHI bola gaya', !(await inbox()).join(' ').includes('Finish it now'));
    await Task.deleteMany({ _id: t._id }); await NudgeLog.deleteMany({});
  });

  await section('TEST 11 — neeche pass kar di gayi copy (forwarded parent) par yaad nahi', async () => {
    const parent = await task({ title: 'Parent kaam', owner: priyanshi._id, assignedBy: khaan._id, dueYMD: addDays(TODAY, -1) });
    await task({ title: 'Child kaam', owner: anjali._id, assignedBy: priyanshi._id, dueYMD: addDays(TODAY, -1), forwardedFrom: parent._id, collaborators: [khaan._id] });
    await runTaskReminders(todayAt('10:05'));
    const box = await inbox();
    check('"Parent kaam" par kisi ko kuch nahi', !box.join(' ').includes('Parent kaam'), JSON.stringify(box));
    check('neeche wale "Child kaam" par ghanti gayi', box.join(' ').includes('Child kaam'), JSON.stringify(box));
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
  });

  await section('TEST 12 — khud ko diya hua kaam → ek hi ghanti, do nahi', async () => {
    await task({ title: 'Apna hi kaam', owner: khaan._id, assignedBy: khaan._id, dueYMD: addDays(TODAY, -1) });
    await runTaskReminders(todayAt('10:05'));
    check('Khaan ko theek ek ghanti (dene wale wali dobara nahi)', (await count({ user: khaan._id })) === 1, String(await count({ user: khaan._id })));
    await Task.deleteMany({}); await NudgeLog.deleteMany({});
  });

  await section('TEST 13 — DONE ho chuke aur bina due date wale task par kuch nahi', async () => {
    await task({ title: 'Ho gaya', owner: anjali._id, assignedBy: khaan._id, dueYMD: addDays(TODAY, -1), status: 'DONE' });
    await task({ title: 'Bina date', owner: anjali._id, assignedBy: khaan._id, dueYMD: '' });
    await task({ title: 'Personal', owner: anjali._id, assignedBy: null, dueYMD: addDays(TODAY, -1) });
    await runTaskReminders(todayAt('10:05'));
    check('teeno par koi ghanti nahi', (await count()) === 0, String(await count()));
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
