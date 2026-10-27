/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * NIYAM (owner, 27 Oct 2026): Kalpana ne Priyanshi ko kaam diya (approval ON), Priyanshi
 * ne Mariya ko aage de diya (approval ON). Mariya kaam karke bhej deti hai — ab tak chain
 * ek-ek kadi karke khulti thi, yaani jab tak PRIYANSHI approve na kare, Kalpana ke paas
 * approve karne ko kuch aata hi nahi tha aur kaam atka rehta tha.
 *
 * Ab CEO & President khud sign kar sakte hain, beech wali kadi ko laanghkar:
 *   - Priyanshi approve kar chuki ho → bilkul pehle jaisa, aam Approve.
 *   - Priyanshi ne nahi kiya → Kalpana phir bhi kar sakti hai, aur usey chetavni dikhti
 *     hai ki Priyanshi ne abhi approve nahi kiya (UI me confirm; server bas ijazat deta hai).
 *   - Poora chain band hota hai: Mariya ka copy bhi approved, Priyanshi ka pending khatam,
 *     sabke points lagte hain, aur kaam Mariya ke hi naam rehta hai.
 *   - KAAM adhoora ho (Mariya ne bheja hi na ho) → kisi ko ijazat nahi. Ye sirf DASTKHAT
 *     laanghta hai, kaam nahi.
 *   - Aam manager (CEO nahi) ko ye power nahi.
 *
 * Run (backend folder se):  node scripts/test-early-signoff.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_earlysign'; // throwaway DB
process.env.APP_LIVE_YMD = '2026-07-01';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Task } from '../src/models/Task.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { Notification } from '../src/models/Notification.js';
import { loadRoles } from '../src/lib/roles.js';
import { setStatus, reviewTask, forwardTask, listTasks } from '../src/services/task.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}
async function refused(fn) {
  try { await fn(); return null; } catch (e) { return e.code || e.message; }
}
const fresh = (t) => Task.findById(t._id ?? t);
const pts = async (u, t) => (await PointEntry.find({ user: u._id, taskRef: t._id ?? t })).reduce((s, r) => s + r.points, 0);
const bells = (u) => Notification.find({ user: u._id }).sort({ createdAt: -1 }).lean();

const RULES = [
  { key: 'assignedTaskOnTime', points: 10 },
  { key: 'assignedTaskLate', points: -5 },
  { key: 'forwardOnTime', points: 3 },
  { key: 'assignTaskDone', points: 3 },
];

let K, P, M, MGR, D; // Kalpana (CEO), Priyanshi, Mariya, ek Manager, Dev (teesri kadi)

/** Kalpana → Priyanshi (approval ON). Lautata hai Priyanshi wala copy. */
async function rootTask(o = {}) {
  return Task.create({
    title: o.title || 'Site survey',
    owner: (o.owner || P)._id,
    assignedBy: (o.by || K)._id,
    collaborators: (o.tag || []).map((u) => u._id),
    requiresApproval: o.requiresApproval !== false,
    dueYMD: '2026-12-31',
    status: 'PENDING',
    createdAt: new Date('2026-09-01T06:00:00Z'),
  });
}
/** Kalpana ki nazar se "approve karne ko kya pada hai". */
async function queue(user) {
  const { tasks } = await listTasks(user, { scope: 'assigned', awaiting: 1, limit: 500 });
  return tasks;
}

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO & President', rank: 0, permissions: ['assignTasks'], isSystem: true },
    { key: 'MANAGER', label: 'Manager', rank: 20, permissions: ['assignTasks'], isSystem: true },
    { key: 'TEAM', label: 'Team', rank: 40, permissions: ['assignTasks'], isSystem: true },
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
  // taskAssign ALL, warna forwardTask ka canAssignTo mana kar deta hai.
  const mk = (n, e, role) => User.create({ name: n, email: e, passwordHash: 'x', role, employeeId: `R-${e[0]}`, isActive: true, taskAssign: { mode: 'ALL', users: [] } });
  K = await mk('Kalpana Saini', 'k@t.co', 'CEO_PRESIDENT');
  P = await mk('Priyanshi Patel', 'p@t.co', 'TEAM');
  M = await mk('Mariya Khan', 'm@t.co', 'TEAM');
  MGR = await mk('Manish Saini', 'g@t.co', 'MANAGER');
  D = await mk('Dev Kumar', 'd@t.co', 'TEAM');

  console.log('TEST 1 — asli scenario: Priyanshi ne approve NAHI kiya, Kalpana kare');
  {
    const a = await rootTask();
    const b = await forwardTask(P, a._id, { assignTo: String(M._id), requiresApproval: true });
    await setStatus(M, b.id, 'DONE'); // Mariya ne bhej diya

    check('Mariya ka copy Priyanshi ke paas atka hai', (await fresh(b.id)).awaitingApproval === true);
    check('Kalpana ka copy abhi submit hua hi nahi (yahi dikkat thi)', (await fresh(a)).submittedAt == null);

    const q = await queue(K);
    const row = q.find((t) => String(t.id) === String(a._id));
    check('phir bhi Kalpana ki list me aa gaya', !!row);
    check('…aur usme "sign kar sakti hai" ka nishaan', row?.canSignOffEarly === true);
    check('…aur kiska dastkhat baaki hai wo naam', JSON.stringify(row?.awaitingSignatureFrom) === JSON.stringify(['Priyanshi Patel']),
      JSON.stringify(row?.awaitingSignatureFrom));
    check('…aam Approve wala nishaan NAHI (wo submit hue par lagta hai)', row?.canReview === false);

    const err = await refused(() => reviewTask(K, a._id, true));
    check('Kalpana ne approve kar diya', err === null, err || '');

    const A = await fresh(a); const B = await fresh(b.id);
    check('Kalpana ka copy DONE', A.status === 'DONE', A.status);
    check('Mariya ka copy bhi DONE (poora chain band)', B.status === 'DONE', B.status);
    check('dono par approve karne wali Kalpana likhi hai', String(A.approvedBy) === String(K._id) && String(B.approvedBy) === String(K._id));
    check('kaam Mariya ke naam hi raha (dono par)', String(A.completedBy) === String(M._id) && String(B.completedBy) === String(M._id),
      `A=${A.completedBy} B=${B.completedBy}`);
    check('Priyanshi ka pending approval khatam', (await fresh(b.id)).awaitingApproval === false);
    check('Kalpana ki list ab khaali', (await queue(K)).length === 0);

    check('Mariya ko kaam ke points mile', (await pts(M, b.id)) === 10, String(await pts(M, b.id)));
    // Aage dene ka inaam forwarder ke APNE copy par likha jaata hai (A), neeche wale par nahi.
    check('Priyanshi ko aage dene ke points mile', (await pts(P, a)) === 3, String(await pts(P, a)));
    check('Kalpana ko kaam karwane ke points mile', (await pts(K, a)) === 3, String(await pts(K, a)));

    const pb = await bells(P);
    check('Priyanshi ko bataya gaya ki uske bina approve hua',
      pb.some((n) => /without waiting for you/i.test(n.title || '')), pb[0]?.title || '(kuch nahi)');
    check('Mariya ko bhi khabar gayi', (await bells(M)).some((n) => /approved your task/i.test(n.title || '')));
  }

  console.log('\nTEST 2 — Priyanshi approve kar chuki ho → bilkul pehle jaisa');
  {
    const a = await rootTask({ title: 'Normal raasta' });
    const b = await forwardTask(P, a._id, { assignTo: String(M._id), requiresApproval: true });
    await setStatus(M, b.id, 'DONE');
    await reviewTask(P, b.id, true); // Priyanshi ne khud approve kiya

    const A = await fresh(a);
    check('ab Kalpana ka copy sach me submit hua hai', A.awaitingApproval === true);
    const row = (await queue(K)).find((t) => String(t.id) === String(a._id));
    check('aam Approve wala nishaan (canReview)', row?.canReview === true);
    check('…aur koi chetavni nahi', !row?.canSignOffEarly, String(row?.canSignOffEarly));

    check('Kalpana approve kar paayi', (await refused(() => reviewTask(K, a._id, true))) === null);
    check('…aur Mariya ka approve karne wala Priyanshi hi raha', String((await fresh(b.id)).approvedBy) === String(P._id));
  }

  console.log('\nTEST 3 — kaam ADHOORA ho to kisi ko ijazat nahi');
  {
    const a = await rootTask({ title: 'Mariya abhi kar rahi hai' });
    await forwardTask(P, a._id, { assignTo: String(M._id), requiresApproval: true });
    // Mariya ne abhi kuch nahi bheja.
    const row = (await queue(K)).find((t) => String(t.id) === String(a._id));
    check('Kalpana ki list me aaya hi nahi', !row, JSON.stringify(row?.canSignOffEarly));
    const err = await refused(() => reviewTask(K, a._id, true));
    check('zabardasti karne par mana', err === 'NOT_AWAITING', err || 'chal gaya!');
    check('…aur kuch bhi band nahi hua', (await fresh(a)).status === 'PENDING');
  }

  console.log('\nTEST 4 — aam manager ko ye power nahi');
  {
    const a = await rootTask({ title: 'Manager ka kaam', by: MGR });
    const b = await forwardTask(P, a._id, { assignTo: String(M._id), requiresApproval: true });
    await setStatus(M, b.id, 'DONE');
    const row = (await queue(MGR)).find((t) => String(t.id) === String(a._id));
    check('Manish ki list me nahi aaya', !row);
    const err = await refused(() => reviewTask(MGR, a._id, true));
    check('Manish ko mana', err === 'NOT_AWAITING', err || 'chal gaya!');
    check('aur bina tag wali Kalpana ko bhi mana (uska task hai hi nahi)',
      (await refused(() => reviewTask(K, a._id, true))) !== null);
    check('…chain waise ka waisa', (await fresh(a)).status === 'PENDING' && (await fresh(b.id)).awaitingApproval === true);
  }

  console.log('\nTEST 5 — teen kadi ka chain (Priyanshi → Mariya → Dev)');
  {
    const a = await rootTask({ title: 'Teen kadi' });
    const b = await forwardTask(P, a._id, { assignTo: String(M._id), requiresApproval: true });
    const c = await forwardTask(M, b.id, { assignTo: String(D._id), requiresApproval: true });
    await setStatus(D, c.id, 'DONE'); // Dev ne kaam kiya

    check('sabse neeche wala Mariya ke paas atka', (await fresh(c.id)).awaitingApproval === true);
    check('beech wala (Priyanshi ke paas) abhi submit bhi nahi hua', (await fresh(b.id)).submittedAt == null);
    const row = (await queue(K)).find((t) => String(t.id) === String(a._id));
    check('Kalpana ki list me aaya', row?.canSignOffEarly === true);
    check('dono ke naam chetavni me', JSON.stringify((row?.awaitingSignatureFrom || []).slice().sort()) === JSON.stringify(['Mariya Khan', 'Priyanshi Patel']),
      JSON.stringify(row?.awaitingSignatureFrom));

    check('Kalpana ne poora chain sign kiya', (await refused(() => reviewTask(K, a._id, true))) === null);
    check('teeno copies DONE', (await fresh(a)).status === 'DONE' && (await fresh(b.id)).status === 'DONE' && (await fresh(c.id)).status === 'DONE');
    check('kaam Dev ke naam (sabse upar tak)', String((await fresh(a)).completedBy) === String(D._id), String((await fresh(a)).completedBy));
    check('Dev ko kaam ke points', (await pts(D, c.id)) === 10, String(await pts(D, c.id)));
  }

  console.log('\nTEST 6 — kinare');
  {
    // (a) beech wale par approval OFF — chain khud band ho jaata hai, kuch karne ko nahi
    const a = await rootTask({ title: 'Beech me approval band' });
    const b = await forwardTask(P, a._id, { assignTo: String(M._id), requiresApproval: false });
    await setStatus(M, b.id, 'DONE');
    const A = await fresh(a);
    check('(a) beech me gate nahi tha → Kalpana ke paas aam tarike se aaya', A.awaitingApproval === true);
    const row = (await queue(K)).find((t) => String(t.id) === String(a._id));
    check('(a) …yaani canReview, koi chetavni nahi', row?.canReview === true && !row?.canSignOffEarly);

    // (b) bina forward wala saada task — purana raasta chhua nahi gaya
    const plain = await rootTask({ title: 'Saada task' });
    await setStatus(P, plain._id, 'DONE');
    const prow = (await queue(K)).find((t) => String(t.id) === String(plain._id));
    check('(b) saada submit hua task: aam Approve', prow?.canReview === true && !prow?.canSignOffEarly);
    check('(b) approve chal gaya', (await refused(() => reviewTask(K, plain._id, true))) === null);

    // (c) jo khud kaam kar chuka ho wo sign na kare. Jad Manish ki hai aur Kalpana us par
    //     TAG hai (isliye wo approver bhi hai), par kaam neeche aakar usi ke paas aa gaya.
    const self = await rootTask({ title: 'Kalpana khud chain me', by: MGR, tag: [K] });
    const sb = await forwardTask(P, self._id, { assignTo: String(K._id), requiresApproval: true });
    await setStatus(K, sb.id, 'DONE');
    check('(c) neeche wala copy Priyanshi ke paas atka', (await fresh(sb.id)).awaitingApproval === true);
    const srow = (await queue(K)).find((t) => String(t.id) === String(self._id));
    check('(c) apna hi kiya kaam sign nahi kar sakti', !srow?.canSignOffEarly, String(srow?.canSignOffEarly));
    check('(c) …server bhi mana kare', (await refused(() => reviewTask(K, self._id, true))) !== null);
    check('(c) …chain waise ka waisa', (await fresh(self)).status === 'PENDING');
  }
}

main()
  .then(async () => {
    console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PAAS'}`);
    if (mongoose.connection.name === 'office_test_earlysign') await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(failures ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(e);
    if (mongoose.connection.name === 'office_test_earlysign') await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(1);
  });
