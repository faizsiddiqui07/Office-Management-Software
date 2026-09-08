/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * NIYAM (owner, 8 Sep 2026): Priyanshi Mariya ko task deti hai aur Khaan Aamir / Kalpana
 * Saini ko TAG karti hai — ab tag kiya hua banda BHI us task ko approve kar sakta hai.
 * Aur sabse zaroori: **kaam dene ka +3 phir bhi PRIYANSHI ko hi milega**, approve karne
 * wale ko nahi.
 *
 * Run (backend folder se):  node scripts/test-tagged-approval.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_taggedapproval'; // throwaway DB
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
import { setStatus, reviewTask, listTasks } from '../src/services/task.service.js';
import { pendingCount, pendingFor, historyFor } from '../src/services/approvals.service.js';
import { getBadges } from '../src/services/badges.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}
/** Kya ye call mana kiya gaya? Code laut kar aata hai taaki sahi wajah check ho sake. */
async function refused(fn) {
  try { await fn(); return null; } catch (e) { return e.code || e.message; }
}
const pts = async (u, t) => (await PointEntry.find({ user: u._id, taskRef: t })).reduce((s, r) => s + r.points, 0);
const entries = (u, t) => PointEntry.find({ user: u._id, taskRef: t }).lean();
const bells = (u, t) => Notification.find({ user: u._id, entityId: t, type: 'TASK_APPROVAL' }).lean();

const RULES = [
  { key: 'assignedTaskOnTime', points: 10 },
  { key: 'assignedTaskLate', points: -5 },
  { key: 'assignedTaskOverdueDaily', points: 1 },
  { key: 'forwardOnTime', points: 3 },
  { key: 'forwardLate', points: -2 },
  { key: 'assignTaskDone', points: 3 },
];

let P, M, K, S, X; // Priyanshi, Mariya, Khaan, Kalpana, eK anjaan banda

/** Priyanshi ka diya hua approval-wala task, Khaan (aur chaahe Kalpana) tagged. */
async function mkTask(o = {}) {
  return Task.create({
    title: o.title || 'Client site survey',
    owner: (o.owner || M)._id,
    assignedBy: o.assignedBy === null ? null : (o.assignedBy || P)._id,
    collaborators: (o.tag || [K]).map((u) => u._id),
    dueYMD: o.due || '2026-12-31',
    requiresApproval: o.requiresApproval !== false,
    status: 'PENDING',
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
    { key: 'CEO_PRESIDENT', label: 'CEO & President', rank: 0, permissions: ['markAttendance', 'approveLeave'], isSystem: true },
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

  P = await User.create({ name: 'Priyanshi Patel', email: 'p@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'A-P', isActive: true });
  M = await User.create({ name: 'Mariya Khan', email: 'm@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'A-M', isActive: true });
  K = await User.create({ name: 'Khaan Aamir', email: 'k@t.co', passwordHash: 'x', role: 'CEO_PRESIDENT', employeeId: 'A-K', isActive: true });
  S = await User.create({ name: 'Kalpana Saini', email: 's@t.co', passwordHash: 'x', role: 'CEO_PRESIDENT', employeeId: 'A-S', isActive: true });
  X = await User.create({ name: 'Koi Aur', email: 'x@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'A-X', isActive: true });

  // ═══ TEST 1 — asli scenario: tag kiya hua banda approve kar sakta hai ═══
  console.log('TEST 1 — Priyanshi ne Mariya ko diya, Khaan ko tag kiya. Khaan approve kare.');
  {
    const t = await mkTask({ tag: [K, S] });
    await setStatus(M, t._id, 'DONE'); // Mariya submit karti hai
    const sub = await Task.findById(t._id);
    check('submit ke baad approval ka intezaar', sub.awaitingApproval === true, sub.status);

    const err = await refused(() => reviewTask(K, t._id, true));
    check('Khaan (tagged) approve kar paaya', err === null, err || '');

    const fin = await Task.findById(t._id);
    check('task ab DONE hai', fin.status === 'DONE');
    check('approvedBy = Khaan (jisne click kiya)', String(fin.approvedBy) === String(K._id));
    check('completedBy = Mariya (jisne kaam kiya)', String(fin.completedBy) === String(M._id));

    // ── POINTS: ye is poore feature ki jaan hai ──
    const assignEntries = await PointEntry.find({ taskRef: t._id, source: 'auto_assign' }).lean();
    check('assign-reward ki THEEK ek entry', assignEntries.length === 1, `got ${assignEntries.length}`);
    check('+3 PRIYANSHI ko mila (jisne kaam diya)', String(assignEntries[0]?.user) === String(P._id),
      assignEntries[0] ? `mila ${String(assignEntries[0].user) === String(K._id) ? 'Khaan ko ❌' : 'kisi aur ko'}` : '');
    check('+3 hi hai', assignEntries[0]?.points === 3, `got ${assignEntries[0]?.points}`);
    check('Khaan (approve karne wale) ko is task se KUCH NAHI', (await entries(K, t._id)).length === 0,
      `got ${(await entries(K, t._id)).length} entry`);
    check('Kalpana (sirf tagged) ko bhi kuch nahi', (await entries(S, t._id)).length === 0);
    check('Mariya ko +10 (waqt par kaam)', (await pts(M, t._id)) === 10, `got ${await pts(M, t._id)}`);
  }

  // ═══ TEST 2 — jo na assigner hai na tagged, wo abhi bhi nahi kar sakta ═══
  console.log('\nTEST 2 — Koi anjaan banda approve na kar paaye');
  {
    const t = await mkTask();
    await setStatus(M, t._id, 'DONE');
    check('anjaan bande ko mana kiya gaya', (await refused(() => reviewTask(X, t._id, true))) === 'FORBIDDEN');
    check('task abhi bhi intezaar me', (await Task.findById(t._id)).awaitingApproval === true);
  }

  // ═══ TEST 3 — apna hi kaam khud approve nahi kar sakte ═══
  console.log('\nTEST 3 — Mariya khud apne collaborators me ho (purana data) to bhi khud approve na kare');
  {
    const t = await mkTask({ tag: [M, K] }); // legacy row: owner khud tag me
    await setStatus(M, t._id, 'DONE');
    const err = await refused(() => reviewTask(M, t._id, true));
    check('Mariya ko mana kiya gaya', err === 'FORBIDDEN', err || 'ALLOW ho gaya ❌');
    check('phir bhi Khaan kar sakta hai', (await refused(() => reviewTask(K, t._id, true))) === null);
  }

  // ═══ TEST 4 — forward karke apna hi kaam approve karne ki chaal ═══
  console.log('\nTEST 4 — Mariya ne Khaan ko forward kiya, Khaan ne kaam kiya → Khaan khud approve na kar paaye');
  {
    const t = await mkTask({ tag: [K, S], title: 'Forwarded survey' });
    // Mariya ne apni copy Khaan ko de di (forward), Khaan ne kaam khatam kiya
    const child = await Task.create({
      title: 'Forwarded survey', owner: K._id, assignedBy: M._id, forwardedFrom: t._id,
      dueYMD: '2026-12-31', status: 'PENDING', createdAt: new Date('2026-09-02T06:00:00Z'),
    });
    await setStatus(K, child._id, 'DONE'); // settleParent parent ko submit karega
    const parent = await Task.findById(t._id);
    check('parent ab approval ka intezaar kar raha', parent.awaitingApproval === true, parent.status);
    check('parent ka completedBy = Khaan (asli doer)', String(parent.completedBy) === String(K._id));

    const err = await refused(() => reviewTask(K, t._id, true));
    check('Khaan ko mana kiya (usne khud kiya tha)', err === 'FORBIDDEN', err || 'APNA HI KAAM APPROVE KAR LIYA ❌');
    check('Kalpana (jisne kaam nahi kiya) kar sakti hai', (await refused(() => reviewTask(S, t._id, true))) === null);
  }

  // ═══ TEST 5 — jiska assigner delete ho chuka, wo pehle jaisa hi band rahe ═══
  console.log('\nTEST 5 — Assigner ka account delete ho gaya (assignedBy null) → koi approve na kar paaye');
  {
    const t = await mkTask({ tag: [K] });
    await setStatus(M, t._id, 'DONE');
    await Task.updateOne({ _id: t._id }, { assignedBy: null, assignerDeleted: true });
    check('Khaan ko bhi mana kiya gaya (aaj jaisa hi)', (await refused(() => reviewTask(K, t._id, true))) === 'FORBIDDEN');
  }

  // ═══ TEST 6 — multi-assign: alag-alag log alag copy approve karein, +3 phir bhi EK ═══
  console.log('\nTEST 6 — 3 logon ko kaam, teen alag tagged log approve karein → Priyanshi ko sirf EK +3');
  {
    const batch = randomUUID();
    const owners = [M, X, await User.create({ name: 'Teesra Banda', email: 't3@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'A-T3', isActive: true })];
    const copies = [];
    for (const o of owners) copies.push(await mkTask({ owner: o, tag: [K, S], batch, title: 'Batch job' }));
    for (let i = 0; i < copies.length; i += 1) await setStatus(owners[i], copies[i]._id, 'DONE');
    // teenon copies alag-alag tagged log approve karte hain
    await reviewTask(K, copies[0]._id, true);
    await reviewTask(S, copies[1]._id, true);
    await reviewTask(K, copies[2]._id, true);

    const asg = await PointEntry.find({ source: 'auto_assign', taskRef: { $in: copies.map((c) => c._id) } }).lean();
    check('assign-reward ki THEEK ek entry (teen nahi)', asg.length === 1, `got ${asg.length}`);
    check('wo bhi Priyanshi ke naam', String(asg[0]?.user) === String(P._id));
    check('approve karne walon ko kuch nahi', (await PointEntry.countDocuments({ user: { $in: [K._id, S._id] }, taskRef: { $in: copies.map((c) => c._id) } })) === 0);
    for (const o of owners) check(`${o.name} ko apna +10`, (await pts(o, copies.map((c) => c._id))) === 10, `got ${await pts(o, copies.map((c) => c._id))}`);
  }

  // ═══ TEST 7 — ghanti sabko jaaye, sahi tab ke link ke saath ═══
  console.log('\nTEST 7 — Submit hote hi assigner AUR tagged sabko "approve this" ghanti');
  {
    const t = await mkTask({ tag: [K, S] });
    await setStatus(M, t._id, 'DONE');
    const bP = await bells(P, t._id); const bK = await bells(K, t._id); const bS = await bells(S, t._id);
    check('Priyanshi (assigner) ko ghanti', bP.length === 1, `got ${bP.length}`);
    check('Khaan (tagged) ko ghanti', bK.length === 1, `got ${bK.length}`);
    check('Kalpana (tagged) ko ghanti', bS.length === 1, `got ${bS.length}`);
    check('Mariya (jisne kaam kiya) ko ghanti NAHI', (await bells(M, t._id)).length === 0);
    check('assigner ka link "assigned" tab par', bP[0]?.link === `/todo?tab=assigned&task=${t._id}`, bP[0]?.link);
    check('tagged ka link "tagged" tab par', bK[0]?.link === `/todo?tab=tagged&task=${t._id}`, bK[0]?.link);

    // Ek ne review kiya → sabki ghanti saaf
    await reviewTask(S, t._id, true);
    check('review ke baad sabki ghanti saaf', (await Notification.countDocuments({ entityId: t._id, type: 'TASK_APPROVAL' })) === 0);
    // ...aur Priyanshi ko pata chale ki uske kaam par kisi aur ne faisla kiya
    const told = await Notification.find({ user: P._id, entityId: t._id, type: { $ne: 'TASK_APPROVAL' } }).lean();
    check('Priyanshi ko khabar mili ki Kalpana ne approve kiya', told.some((n) => /Kalpana Saini approved/.test(n.title)),
      told.map((n) => n.title).join(' | ') || 'koi khabar nahi ❌');
  }

  // ═══ TEST 8 — tagged banda wapas bhi bhej sakta hai, aur assigner ko pata chale ═══
  console.log('\nTEST 8 — Tagged banda kaam wapas bhej de (reject)');
  {
    const t = await mkTask({ tag: [K] });
    await setStatus(M, t._id, 'DONE');
    check('Khaan reject kar paaya', (await refused(() => reviewTask(K, t._id, false, 'measurements adhoore hain'))) === null);
    const fin = await Task.findById(t._id);
    check('task wapas pending', fin.status === 'PENDING' && !fin.submittedAt);
    check('wajah save hui', fin.rejectionReason === 'measurements adhoore hain');
    // NOTE: reject wali notification par entityId set nahi hota (purana behaviour),
    // isliye title se dhoondh rahe hain.
    const toM = await Notification.find({ user: M._id }).lean();
    check('Mariya ko wapas bheje jaane ki khabar', toM.some((n) => /Khaan Aamir sent your task back/.test(n.title)),
      toM.map((n) => n.title).join(' | ') || 'koi khabar nahi');
    const told = await Notification.find({ user: P._id, entityId: t._id }).lean();
    check('Priyanshi ko bhi khabar', told.some((n) => /sent back work you assigned/.test(n.title)),
      told.map((n) => n.title).join(' | ') || 'koi khabar nahi ❌');
    check('kisi ko koi point nahi mila', (await PointEntry.countDocuments({ taskRef: t._id })) === 0);
  }

  // ═══ TEST 9 — Approvals inbox me tagged wale bhi ginein ═══
  console.log('\nTEST 9 — Approvals page ka counter');
  {
    await Task.deleteMany({});
    await Notification.deleteMany({});
    const t = await mkTask({ tag: [K] });
    await setStatus(M, t._id, 'DONE');
    const cP = await pendingCount(P); const cK = await pendingCount(K); const cS = await pendingCount(S);
    check('Khaan (tagged) ke inbox me 1', cK.tasks === 1, `got ${cK.tasks}`);
    check('Kalpana (tag nahi hai) ke inbox me 0', cS.tasks === 0, `got ${cS.tasks}`);
    // PURANA NIYAM (is feature se pehle se): Approvals page ka tasks-section
    // approveLeave/approveRegularization permission par gated hai. Priyanshi TEAM hai,
    // uske paas wo permission nahi — isliye apne diye hue kaam ka approval bhi use
    // Approvals page par kabhi nahi dikha, sirf To-Do page par dikhta hai.
    check('Priyanshi (bina approve-permission) ko Approvals page par 0 — purana niyam', cP.tasks === 0, `got ${cP.tasks}`);
  }

  // ═══ TEST 10 — CONTROL: bina approval wale task par kuch na badle ═══
  console.log('\nTEST 10 — CONTROL: jis task me approval maanga hi nahi gaya');
  {
    const t = await mkTask({ tag: [K], requiresApproval: false });
    await setStatus(M, t._id, 'DONE');
    check('seedha DONE ho gaya', (await Task.findById(t._id)).status === 'DONE');
    check('Khaan ko review karne ko kuch nahi', (await refused(() => reviewTask(K, t._id, true))) === 'NOT_AWAITING');
    check('+3 phir bhi Priyanshi ko', String((await PointEntry.findOne({ taskRef: t._id, source: 'auto_assign' }))?.user) === String(P._id));
  }

  // ═══ TEST 11 — lambi forward chain: tagged banda jo beech me kaam kar chuka hai ═══
  // Review ne pakda tha: bell aur Approve button dono dikh rahe the, par guard 403 karta tha.
  console.log('\nTEST 11 — 3 haath-badal ki chain: beech wala tagged banda approve na kar paaye, aur use bulaya bhi na jaaye');
  {
    await Task.deleteMany({});
    await Notification.deleteMany({});
    const R = await User.create({ name: 'Rahul Verma', email: 'r@t.co', passwordHash: 'x', role: 'CEO_PRESIDENT', employeeId: 'A-R', isActive: true });
    const A = await User.create({ name: 'Anil Gupta', email: 'an@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'A-AN', isActive: true });
    const root = await mkTask({ tag: [R, S], title: 'Tender file' }); // Rahul + Kalpana tagged
    // Mariya → Kalpana → Rahul → Anil
    const hand = (owner, by, from) => Task.create({
      title: 'Tender file', owner: owner._id, assignedBy: by._id, forwardedFrom: from._id,
      dueYMD: '2026-12-31', status: 'PENDING', createdAt: new Date('2026-09-02T06:00:00Z'),
    });
    const c1 = await hand(S, M, root);
    const c2 = await hand(R, S, c1);
    const c3 = await hand(A, R, c2);
    await setStatus(A, c3._id, 'DONE'); // poori chain settle → root submit ho jaata hai

    const parent = await Task.findById(root._id);
    check('root approval ka intezaar kar raha', parent.awaitingApproval === true, parent.status);
    check('root ka completedBy = Anil (sabse neeche wala doer)', String(parent.completedBy) === String(A._id));

    check('Rahul (chain me hai) ko bell NAHI gayi', (await bells(R, root._id)).length === 0, `got ${(await bells(R, root._id)).length}`);
    check('Kalpana (wo bhi chain me hai) ko bell NAHI', (await bells(S, root._id)).length === 0, `got ${(await bells(S, root._id)).length}`);
    check('Priyanshi (assigner) ko bell gayi', (await bells(P, root._id)).length === 1, `got ${(await bells(P, root._id)).length}`);

    const listed = await listTasks(R, { scope: 'tagged', limit: 200 });
    const row = (listed.tasks || []).find((t) => String(t.id) === String(root._id));
    check('Rahul ke row par canReview = false', !!row && row.canReview === false, row ? `got ${row.canReview}` : 'row hi nahi aayi');
    check('Rahul ko guard ne bhi mana kiya', (await refused(() => reviewTask(R, root._id, true))) === 'FORBIDDEN');
    check('Rahul ke Approvals inbox me 0 row', ((await pendingFor(R)).tasks || []).length === 0);
    check('Rahul ka counter bhi 0', (await pendingCount(R)).tasks === 0, `got ${(await pendingCount(R)).tasks}`);
    check('Rahul ka bell-dot bhi khaali', (await getBadges(R)).approvals == null, `got ${(await getBadges(R)).approvals}`);

    check('Priyanshi (jisne kaam nahi kiya) approve kar sakti hai', (await refused(() => reviewTask(P, root._id, true))) === null);
  }

  // ═══ TEST 12 — ek-level forward: inbox aur guard ek hi baat kahein ═══
  console.log('\nTEST 12 — Khaan ne forward se kaam kiya: uske inbox me row aani hi nahi chahiye');
  {
    await Task.deleteMany({});
    await Notification.deleteMany({});
    const t = await mkTask({ tag: [K, S] });
    await Task.create({
      title: 'Client site survey', owner: K._id, assignedBy: M._id, forwardedFrom: t._id,
      dueYMD: '2026-12-31', status: 'PENDING', createdAt: new Date('2026-09-02T06:00:00Z'),
    });
    const child = await Task.findOne({ forwardedFrom: t._id });
    await setStatus(K, child._id, 'DONE');
    check('Khaan ko guard ne mana kiya', (await refused(() => reviewTask(K, t._id, true))) === 'FORBIDDEN');
    check('Khaan ke inbox me bhi 0 (dead button na dikhe)', (await pendingCount(K)).tasks === 0, `got ${(await pendingCount(K)).tasks}`);
    check('Khaan ka bell-dot khaali', (await getBadges(K)).approvals == null, `got ${(await getBadges(K)).approvals}`);
    check('Kalpana (chain se bahar) ke inbox me row aayi', (await pendingCount(S)).tasks === 1, `got ${(await pendingCount(S)).tasks}`);
  }

  // ═══ TEST 13 — kisi aur ke approve karne par assigner ka record na mite ═══
  console.log('\nTEST 13 — Kalpana ne approve kiya → Khaan (jisne kaam diya) ki History me record rahe');
  {
    await Task.deleteMany({});
    const t = await mkTask({ assignedBy: K, tag: [S] }); // Khaan ne diya, Kalpana tagged
    await setStatus(M, t._id, 'DONE');
    await reviewTask(S, t._id, true);
    const hK = await historyFor(K, {});
    check('Khaan ki History me dikh raha', (hK.tasks || []).some((x) => String(x.id) === String(t._id)), `got ${(hK.tasks || []).length} row`);
    const hS = await historyFor(S, {});
    check('Kalpana (jisne approve kiya) ki History me bhi', (hS.tasks || []).some((x) => String(x.id) === String(t._id)));
  }

  // ═══ TEST 14 — assigner delete ho gaya: inbox me bhoot na rahe ═══
  console.log('\nTEST 14 — Assigner ka account delete: tagged bande ke inbox me phansa na rahe');
  {
    await Task.deleteMany({});
    const t = await mkTask({ tag: [K] });
    await setStatus(M, t._id, 'DONE');
    await Task.updateOne({ _id: t._id }, { assignedBy: null, assignerDeleted: true });
    check('Khaan ke inbox me 0', (await pendingCount(K)).tasks === 0, `got ${(await pendingCount(K)).tasks}`);
    check('bell-dot bhi khaali', (await getBadges(K)).approvals == null);
    check('guard bhi mana karta hai', (await refused(() => reviewTask(K, t._id, true))) === 'FORBIDDEN');
  }

  console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PASS'}\n`);
  await mongoose.connection.dropDatabase();
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
