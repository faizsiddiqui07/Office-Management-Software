/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * NIYAM (owner, 25 Oct 2026) — kaam baaNTne ke baad DUE DATE kaun badal sakta hai:
 *   1. JISNE TASK DIYA (assigner) — hamesha. Purana "deadline assign hote hi pakki" wala
 *      niyam (24 Aug 2026) owner ne wapas le liya.
 *   2. Jo CEO & President us task par TAG kiya gaya ho — par SIRF due date. Title, notes,
 *      kisko assigned hai, approval ka switch aur delete — sab assigner ke hi paas.
 *   3. Aur koi nahi: na jisko task mila hai, na bina tag wala CEO, na tagged aam employee.
 *
 * Saath me ye bhi jaancha jaata hai ki date khisakne par POINTS dobara lagte hain (late ka
 * penalty hat jaaye / lag jaaye), batch ki saari copies aur forward chain bhi chalein, aur
 * assigner ko khabar mile.
 *
 * Run (backend folder se):  node scripts/test-due-date-edit.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_duedate'; // throwaway DB
process.env.APP_LIVE_YMD = '2026-07-01';

import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Task } from '../src/models/Task.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { Notification } from '../src/models/Notification.js';
import { loadRoles } from '../src/lib/roles.js';
import { updateTask, deleteTask } from '../src/services/task.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}
/** Kya ye call mana kiya gaya? Code laut kar aata hai taaki sahi WAJAH bhi jaanchi ja sake. */
async function refused(fn) {
  try { await fn(); return null; } catch (e) { return e.code || e.message; }
}
const due = async (t) => (await Task.findById(t._id ?? t)).dueYMD;
const pts = async (u, t) => (await PointEntry.find({ user: u._id, taskRef: t._id ?? t })).reduce((s, r) => s + r.points, 0);

const RULES = [
  { key: 'assignedTaskOnTime', points: 10 },
  { key: 'assignedTaskLate', points: -5 },
  { key: 'assignedTaskOverdueDaily', points: 1 },
  { key: 'assignTaskDone', points: 3 },
];

let P, M, K, S, X; // Priyanshi (deti hai), Mariya (karti hai), Khaan + Kalpana (CEO), Koi Aur

/** Priyanshi ka diya task, Khaan tagged. Ban'ne ki tareekh purane lock ke floor ke BAAD. */
async function mkTask(o = {}) {
  return Task.create({
    title: o.title || 'Client site survey',
    owner: (o.owner || M)._id,
    assignedBy: o.assignedBy === null ? null : (o.assignedBy || P)._id,
    collaborators: (o.tag || [K]).map((u) => u._id),
    dueYMD: o.due === null ? '' : (o.due || '2026-12-31'),
    requiresApproval: !!o.requiresApproval,
    status: o.status || 'PENDING',
    assignBatch: o.batch || null,
    forwardedFrom: o.forwardedFrom || null,
    createdAt: new Date('2026-09-01T06:00:00Z'),
    ...(o.extra || {}),
  });
}

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO & President', rank: 0, permissions: ['markAttendance'], isSystem: true },
    { key: 'MANAGER', label: 'Manager', rank: 20, permissions: ['markAttendance', 'assignTasks'], isSystem: true },
    { key: 'TEAM', label: 'Team', rank: 40, permissions: ['markAttendance'], isSystem: true },
  ]);
  await loadRoles();
  await Setting.create({
    key: 'global', companyName: 'TestCo', weekendDays: [0],
    bonus: {
      enabled: true, rupeesPerPoint: 0, graceDays: 0,
      autoRules: [...RULES],
      rateHistory: [{ effectiveFrom: '2026-08-01', graceDays: 0, rules: [...RULES], changedAt: new Date() }],
    },
  });
  Setting.invalidateCache();

  P = await User.create({ name: 'Priyanshi Patel', email: 'p@t.co', passwordHash: 'x', role: 'MANAGER', employeeId: 'A-P', isActive: true });
  M = await User.create({ name: 'Mariya Khan', email: 'm@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'A-M', isActive: true });
  K = await User.create({ name: 'Khaan Aamir', email: 'k@t.co', passwordHash: 'x', role: 'CEO_PRESIDENT', employeeId: 'A-K', isActive: true });
  S = await User.create({ name: 'Kalpana Saini', email: 's@t.co', passwordHash: 'x', role: 'CEO_PRESIDENT', employeeId: 'A-S', isActive: true });
  X = await User.create({ name: 'Koi Aur', email: 'x@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'A-X', isActive: true });

  // ═══ TEST 1 — asli scenario ═══
  console.log('TEST 1 — Priyanshi ne Mariya ko task diya, Khaan (CEO) ko tag kiya');
  {
    const t = await mkTask({ tag: [K] });
    // (a) Assigner. PURANE code me yahi DUE_DATE_LOCKED se mana hota tha.
    let err = await refused(() => updateTask(P, t._id, { dueYMD: '2026-12-20' }));
    check('Priyanshi (jisne diya) due date badal paayi', err === null, err || '');
    check('…aur date sach me badli', (await due(t)) === '2026-12-20', await due(t));

    // (b) Tagged CEO.
    err = await refused(() => updateTask(K, t._id, { dueYMD: '2026-12-25' }));
    check('Khaan (tagged CEO) due date badal paaya', err === null, err || '');
    check('…aur date sach me badli', (await due(t)) === '2026-12-25', await due(t));

    // (c) Jisko kaam mila hai.
    err = await refused(() => updateTask(M, t._id, { dueYMD: '2027-01-01' }));
    check('Mariya (jisko mila) nahi badal sakti', err === 'ASSIGNED_TASK', err || 'chal gaya!');
    check('…date waisi hi', (await due(t)) === '2026-12-25', await due(t));
  }

  // ═══ TEST 2 — tag nahi hua to CEO bhi nahi ═══
  console.log('\nTEST 2 — bina tag wala CEO, aur tagged aam employee');
  {
    const t = await mkTask({ tag: [K] });
    let err = await refused(() => updateTask(S, t._id, { dueYMD: '2026-11-01' }));
    check('Kalpana (CEO, par TAG nahi) nahi badal sakti', err === 'ASSIGNED_TASK', err || 'chal gaya!');

    const t2 = await mkTask({ tag: [X] });
    err = await refused(() => updateTask(X, t2._id, { dueYMD: '2026-11-01' }));
    check('Koi Aur (tagged, par aam employee) nahi badal sakta', err === 'ASSIGNED_TASK', err || 'chal gaya!');
    check('…dono ki date waisi hi', (await due(t)) === '2026-12-31' && (await due(t2)) === '2026-12-31');
  }

  // ═══ TEST 3 — tagged CEO sirf due date, aur kuch nahi ═══
  console.log('\nTEST 3 — tagged CEO baaki kuch na badal paaye');
  {
    const t = await mkTask({ tag: [K], title: 'Original title', extra: { notes: 'original notes' } });
    const tries = [
      ['title badalna', { title: 'Khaan ka naya title' }],
      ['notes badalna', { notes: 'badla hua' }],
      ['kisi aur ko de dena', { assignTo: [String(X._id)] }],
      ['approval ka switch', { requiresApproval: true }],
      ['tag list badalna', { collaborators: [String(S._id)] }],
      ['tag hatana (khaali list)', { collaborators: [] }],
      ['date ke SAATH title', { dueYMD: '2026-12-01', title: 'chupke se' }],
    ];
    for (const [label, body] of tries) {
      // eslint-disable-next-line no-await-in-loop
      const err = await refused(() => updateTask(K, t._id, body));
      check(label, err === 'DUE_DATE_ONLY', err || 'chal gaya!');
    }
    const fin = await Task.findById(t._id);
    check('task bilkul waisa hi: title, notes, owner, approval, tag', fin.title === 'Original title'
      && fin.notes === 'original notes' && String(fin.owner) === String(M._id)
      && fin.requiresApproval === false && fin.collaborators.length === 1
      && String(fin.collaborators[0]) === String(K._id) && fin.dueYMD === '2026-12-31');

    // Form poora task wapas bhejta hai — BINA badle field save ko rokna nahi chahiye.
    const err = await refused(() => updateTask(K, t._id, {
      title: 'Original title', notes: 'original notes', dueYMD: '2026-12-10',
      requiresApproval: false, collaborators: [String(K._id)],
    }));
    check('poora task wapas bheja par sirf date badli → chal gaya', err === null, err || '');
    check('…date 2026-12-10', (await due(t)) === '2026-12-10', await due(t));
  }

  // ═══ TEST 4 — personal task par koi asar nahi ═══
  console.log('\nTEST 4 — apna personal task (kisi ne diya hi nahi)');
  {
    const own = await mkTask({ owner: M, assignedBy: null, tag: [K] });
    let err = await refused(() => updateTask(M, own._id, { dueYMD: '2026-10-05', title: 'mera kaam' }));
    check('Mariya apna task poora edit kar sakti hai', err === null, err || '');
    err = await refused(() => updateTask(K, own._id, { dueYMD: '2026-10-09' }));
    check('tagged CEO doosre ke PERSONAL task me nahi ghus sakta', err === 'FORBIDDEN', err || 'chal gaya!');
    check('…date wahi', (await due(own)) === '2026-10-05', await due(own));
  }

  // ═══ TEST 5 — points dobara lagte hain ═══
  console.log('\nTEST 5 — date khisakne par points dobara');
  {
    // Late ke do alag penalty hain: ek baar ka nishaan (−5), aur HAR beete din ka −1.
    // Dono ko nayi date ke hisaab se dobara lagna chahiye.
    const lateMark = async (tt) => (await PointEntry.findOne({ taskRef: tt._id, dedupeKey: `auto_task:${tt._id}` }))?.points ?? 0;
    const dailyDays = (tt) => PointEntry.countDocuments({ taskRef: tt._id, dedupeKey: { $regex: `^auto_overdue:${tt._id}:` } });

    // Mariya ne 20 Sep ko poora kiya, due 15 Sep tha → late.
    const t = await mkTask({
      due: '2026-09-15', status: 'DONE',
      extra: { completedAt: new Date('2026-09-20T06:00:00Z'), completedBy: M._id },
    });
    const { onAssignedTaskDone, rebuildOverdueForTask } = await import('../src/services/bonus.service.js');
    await onAssignedTaskDone(await Task.findById(t._id));
    await rebuildOverdueForTask(t._id);
    const days15 = await dailyDays(t);
    check('pehle: late ka −5 nishaan', (await lateMark(t)) === -5, String(await lateMark(t)));
    check('…aur beete dinoN ka roz ka penalty bhi laga', days15 > 0, `${days15} din`);

    // Khaan date 25 Sep kar deta hai → kaam ab on-time ho gaya.
    await updateTask(K, t._id, { dueYMD: '2026-09-25' });
    check('CEO ne date aage ki → Mariya ko +10 (on time)', (await pts(M, t)) === 10, String(await pts(M, t)));
    check('…aur roz wala penalty poora hat gaya', (await dailyDays(t)) === 0, `${await dailyDays(t)} din`);

    // Aur wapas 10 Sep → phir late, aur 15 Sep waale se ZYADA din ka penalty.
    await updateTask(P, t._id, { dueYMD: '2026-09-10' });
    const days10 = await dailyDays(t);
    check('assigner ne date peeche ki → phir −5 ka nishaan', (await lateMark(t)) === -5, String(await lateMark(t)));
    check('…aur roz ka penalty NAYI date se gina gaya (pehle se zyada din)', days10 > days15, `${days10} din vs pehle ${days15}`);
    check('kul points negative', (await pts(M, t)) === -5 - days10, String(await pts(M, t)));
    check('Priyanshi ka "kaam karwaya" +3 har baar bacha raha', (await pts(P, t)) === 3, String(await pts(P, t)));
  }

  // ═══ TEST 6 — batch ki saari copies ═══
  console.log('\nTEST 6 — ek hi kaam teen logon ko (batch)');
  {
    const batch = randomUUID();
    const a = await mkTask({ owner: M, batch, tag: [K] });
    const b = await mkTask({ owner: X, batch, tag: [K] });
    const c = await mkTask({ owner: S, batch, tag: [K] });

    await updateTask(K, a._id, { dueYMD: '2026-12-05', applyToAll: true });
    check('CEO ne applyToAll kiya → teeno copies ki date badli',
      (await due(a)) === '2026-12-05' && (await due(b)) === '2026-12-05' && (await due(c)) === '2026-12-05',
      `${await due(a)} / ${await due(b)} / ${await due(c)}`);

    await updateTask(K, b._id, { dueYMD: '2026-12-09' });
    check('applyToAll ke bina sirf khuli copy badli',
      (await due(b)) === '2026-12-09' && (await due(a)) === '2026-12-05' && (await due(c)) === '2026-12-05',
      `${await due(a)} / ${await due(b)} / ${await due(c)}`);

    // Siblings ka approval switch alag ho sakta hai — CEO ki date wali save use na chhue.
    await Task.updateOne({ _id: c._id }, { $set: { requiresApproval: true } });
    await updateTask(K, a._id, { dueYMD: '2026-12-06', applyToAll: true, requiresApproval: false });
    const cc = await Task.findById(c._id);
    check('sibling ka approval switch CEO ki save se nahi hila', cc.requiresApproval === true, String(cc.requiresApproval));
  }

  // ═══ TEST 7 — forward chain ═══
  console.log('\nTEST 7 — Mariya ne aage pass kiya (forward chain)');
  {
    const root = await mkTask({ owner: M, tag: [K] });
    const kid = await mkTask({ owner: X, assignedBy: M, tag: [], forwardedFrom: root._id, due: '2026-12-31' });
    await updateTask(K, root._id, { dueYMD: '2026-12-15' });
    check('chain ke neeche wali copy ki date bhi badli', (await due(kid)) === '2026-12-15', await due(kid));
  }

  // ═══ TEST 8 — khabar kisko mile ═══
  console.log('\nTEST 8 — notification');
  {
    const t = await mkTask({ tag: [K] });
    await Notification.deleteMany({});
    await updateTask(K, t._id, { dueYMD: '2026-12-11' });
    const toAssigner = await Notification.find({ user: P._id }).lean();
    const toDoer = await Notification.find({ user: M._id }).lean();
    check('Priyanshi (jisne diya) ko khabar gayi', toAssigner.length === 1, String(toAssigner.length));
    check('…usme CEO ka naam aur nayi date', /Khaan/.test(toAssigner[0]?.title || '') && /2026-12-11/.test(toAssigner[0]?.message || ''),
      `${toAssigner[0]?.title} | ${toAssigner[0]?.message}`);
    check('Mariya (jisko karna hai) ko bhi khabar gayi', toDoer.length === 1, String(toDoer.length));

    // Assigner khud badle to use apni hi khabar na mile.
    await Notification.deleteMany({});
    await updateTask(P, t._id, { dueYMD: '2026-12-12' });
    check('assigner khud badle to use apni khabar nahi', (await Notification.countDocuments({ user: P._id })) === 0);
  }

  // ═══ TEST 9 — delete phir bhi sirf assigner ke paas ═══
  console.log('\nTEST 9 — delete');
  {
    const t = await mkTask({ tag: [K] });
    const err = await refused(() => deleteTask(K, t._id));
    check('tagged CEO task delete NAHI kar sakta', err === 'ASSIGNED_TASK', err || 'chal gaya!');
    check('…task zinda hai', !!(await Task.findById(t._id)));
    check('assigner delete kar sakti hai', (await refused(() => deleteTask(P, t._id))) === null);
  }

  // ═══ TEST 10 — date hatana aur daalna ═══
  console.log('\nTEST 10 — date hatana / bina date wale task par daalna');
  {
    const t = await mkTask({ tag: [K] });
    await updateTask(K, t._id, { dueYMD: '' });
    check('CEO date hata saka', (await due(t)) === '', `"${await due(t)}"`);
    await updateTask(K, t._id, { dueYMD: '2026-12-28' });
    check('…aur bina date wale par nayi date daal saka', (await due(t)) === '2026-12-28', await due(t));
  }
}

main()
  .then(async () => {
    console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PAAS'}`);
    if (mongoose.connection.name === 'office_test_duedate') await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(failures ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(e);
    if (mongoose.connection.name === 'office_test_duedate') await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(1);
  });
