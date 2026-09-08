/**
 * TO-DO PAGE — POINTS KA POORA PERMUTATION AUDIT (ISOLATED DB, asli data ko chhuta NAHI)
 *
 * Sawaal jo owner ne poochha:
 *   "task kisi ko assign hua aur wahi task kisi ko TAG kiya gaya → kiske points katenge?"
 *   "do logon ko assign hua → kab kiske katenge?"
 *
 * Ye script asli service code (bonus.service.js / task.service.js) ko har permutation par
 * chala kar SACH ki table chhapti hai — padh kar andaza nahi, chala kar nateeja.
 *
 * Rates asli prod se liye gaye hain: onTime +10, late -5, roz -1, forward +3/-2,
 * assign-done +3, grace 0.
 *
 * Run (backend folder se):  node scripts/audit-todo-points-matrix.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_todomatrix'; // throwaway DB
process.env.APP_LIVE_YMD = '2026-07-01';           // prod jaisa

import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Task } from '../src/models/Task.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { Holiday } from '../src/models/Holiday.js';
import { loadRoles } from '../src/lib/roles.js';
import { ymdInTz } from '../src/lib/time.js';
import { onAssignedTaskDone, rebuildOverdueForTask, taskBonusPreview, maybeRunDaily } from '../src/services/bonus.service.js';

const TODAY = ymdInTz(new Date());
const D = (ymd) => new Date(`${ymd}T06:00:00Z`);

// Timeline — sab kuch aaj se peechhe, taaki "pending" ka poora hisaab ban sake.
const ASSIGNED = '2026-09-01'; // 1 Aug ke baad → assigner reward chalu
const DUE = '2026-09-03';
const ONTIME = '2026-09-02';
const LATE = '2026-09-07';
const OLD_ASSIGNED = '2026-07-20'; // 1 Aug se pehle → grandfathered

const RULES = [
  { key: 'assignedTaskOnTime', points: 10 },
  { key: 'assignedTaskLate', points: -5 },
  { key: 'assignedTaskOverdueDaily', points: 1 },
  { key: 'forwardOnTime', points: 3 },
  { key: 'forwardLate', points: -2 },
  { key: 'assignTaskDone', points: 3 },
];

let U = {};
const findings = [];
function flag(sev, what) { findings.push(`[${sev}] ${what}`); }

/** Kisi bande ke kitne points is task (ya in tasks) se. */
async function pts(user, taskIds) {
  const rows = await PointEntry.find({ user: user._id, taskRef: { $in: [].concat(taskIds) } }).lean();
  return rows.reduce((s, r) => s + r.points, 0);
}
async function rowsFor(user, taskIds) {
  return PointEntry.find({ user: user._id, taskRef: { $in: [].concat(taskIds) } }).sort({ earnedYMD: 1 }).lean();
}
const n = (x) => (x > 0 ? `+${x}` : String(x));

/** Ek copy banao. */
async function mkTask(o) {
  const t = await Task.create({
    title: o.title || 'Job',
    owner: o.owner._id,
    assignedBy: o.assignedBy ? o.assignedBy._id : null,
    collaborators: (o.tag || []).map((u) => u._id),
    dueYMD: o.due === null ? '' : (o.due || DUE),
    status: o.status || 'PENDING',
    completedAt: o.completedAt ? D(o.completedAt) : null,
    completedBy: o.completedAt ? o.owner._id : null,
    requiresApproval: !!o.requiresApproval,
    submittedAt: o.submittedAt ? D(o.submittedAt) : null,
    assignBatch: o.batch || null,
    forwardedFrom: o.forwardedFrom || null,
    createdAt: D(o.assignedOn || ASSIGNED),
  });
  // Mongoose timestamps createdAt ko chura na le — audit ka poora grandfathering isi par hai.
  const back = await Task.findById(t._id).select('createdAt').lean();
  if (ymdInTz(back.createdAt) !== (o.assignedOn || ASSIGNED)) {
    flag('BLOCKER', `createdAt set nahi ho raha (chaha ${o.assignedOn || ASSIGNED}, mila ${ymdInTz(back.createdAt)}) — audit ke grandfathering wale nateeje bharose ke layak nahi`);
  }
  return t;
}

/** Task ko score karo, waise hi jaise asli zindagi me hota: done → award, pending → overdue. */
async function score(t) {
  if (t.status === 'DONE') await onAssignedTaskDone(t);
  else await rebuildOverdueForTask(t._id);
}

async function reset() {
  await PointEntry.deleteMany({});
  await Task.deleteMany({});
}

// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();

  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO & President', rank: 0, permissions: ['markAttendance'], isSystem: true },
    { key: 'MANAGER', label: 'Manager', rank: 20, permissions: ['markAttendance'], isSystem: true },
    { key: 'EMPLOYEE', label: 'Employee', rank: 50, permissions: ['markAttendance'], isSystem: true },
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

  U.ceo = await User.create({ name: 'CEO Sahab', email: 'ceo@t.co', passwordHash: 'x', role: 'CEO_PRESIDENT', employeeId: 'M-CEO', isActive: true });
  U.mgr = await User.create({ name: 'Manager Ji', email: 'mgr@t.co', passwordHash: 'x', role: 'MANAGER', employeeId: 'M-MGR', isActive: true });
  U.e1 = await User.create({ name: 'Employee One', email: 'e1@t.co', passwordHash: 'x', role: 'EMPLOYEE', employeeId: 'M-E1', isActive: true });
  U.e2 = await User.create({ name: 'Employee Two', email: 'e2@t.co', passwordHash: 'x', role: 'EMPLOYEE', employeeId: 'M-E2', isActive: true });
  U.obs = await User.create({ name: 'Observer', email: 'ob@t.co', passwordHash: 'x', role: 'EMPLOYEE', employeeId: 'M-OB', isActive: true });

  console.log(`\n${'='.repeat(96)}`);
  console.log(`TO-DO POINTS MATRIX  |  aaj: ${TODAY}  |  due ${DUE}, on-time ${ONTIME}, late ${LATE}`);
  console.log(`rates: on-time +10 | late -5 | har extra din -1 | forward +3/-2 | assign-done +3 | grace 0`);
  console.log('='.repeat(96));

  // ════════════════ PART 1 — EK BANDE KO ASSIGN (36 combos) ════════════════
  console.log('\n\n### PART 1 — Ek bande ko assign. Assigner × Tag × Due-date × Nateeja (36 combos)\n');
  console.log('  assigner  | tag kisko   | due | nateeja  || DOER(E1) | ASSIGNER | TAGGED');
  console.log('  ' + '-'.repeat(88));

  const assigners = [['CEO', 'ceo'], ['Manager', 'mgr']];
  const tags = [['—', null], ['Observer', 'obs'], ['CEO', 'ceo']];
  const dues = [['yes', DUE], ['no', null]];
  const outcomes = ['on-time', 'late', 'pending'];

  const part1 = [];
  for (const [aLabel, aKey] of assigners) {
    for (const [tLabel, tKey] of tags) {
      for (const [dLabel, dVal] of dues) {
        for (const out of outcomes) {
          if (dVal === null && out !== 'pending') continue; // bina due ke "late/on-time" ka matlab hi nahi
          await reset();
          const tagUsers = tKey ? [U[tKey]] : [];
          const t = await mkTask({
            owner: U.e1, assignedBy: U[aKey], tag: tagUsers, due: dVal,
            status: out === 'pending' ? 'PENDING' : 'DONE',
            completedAt: out === 'on-time' ? ONTIME : out === 'late' ? LATE : null,
          });
          await score(t);
          const doer = await pts(U.e1, t._id);
          const asg = await pts(U[aKey], t._id);
          const tag = tagUsers.length ? await pts(tagUsers[0], t._id) : 0;
          part1.push({ aLabel, tLabel, dLabel, out, doer, asg, tag, taggedIsCeo: tKey === 'ceo' });
          console.log(`  ${aLabel.padEnd(9)} | ${tLabel.padEnd(11)} | ${dLabel.padEnd(3)} | ${out.padEnd(8)} || ${n(doer).padStart(8)} | ${n(asg).padStart(8)} | ${n(tag).padStart(6)}`);
          // Agar tag kiya banda KHUD assigner hi hai, to ye column assigner wali entry
          // dobara gin raha hai — alag payment nahi. Sirf tab shikayat karo jab tagged
          // bystander ho.
          const tagIsAssigner = tKey === aKey;
          if (tag !== 0 && !tagIsAssigner) flag('BLOCKER', `TAGGED bande ke points kate/mile: ${aLabel}/${tLabel}/${dLabel}/${out} → ${n(tag)}`);
          if (tag !== 0 && tagIsAssigner) part1[part1.length - 1].tagNote = '(= assigner wali hi entry)';
        }
      }
    }
  }

  // ── Part 1 ke nateeje ka nichod ──
  const eligible = part1.filter((r) => r.aLabel === 'CEO' || r.taggedIsCeo);
  const invisible = part1.filter((r) => !(r.aLabel === 'CEO' || r.taggedIsCeo));
  console.log(`\n  → CEO ko dikhne wale (${eligible.length} rows): points chalte hain`);
  console.log(`  → CEO ko NA dikhne wale (${invisible.length} rows): sab sifar? ${invisible.every((r) => !r.doer && !r.asg && !r.tag) ? 'HAAN' : 'NAHI ❌'}`);
  const bystander = part1.filter((r) => r.tLabel !== '—' && r.tLabel !== r.aLabel);
  console.log(`  → TAGGED bystander ko kisi bhi combo me kuch mila/kata? ${bystander.every((r) => r.tag === 0) ? `NAHI — saare ${bystander.length} combos me theek 0 (sahi)` : 'HAAN ❌'}`);

  // ════════════════ PART 2 — PENDING ka din-ba-din hisaab ════════════════
  console.log('\n\n### PART 2 — Ek pending task roz kitna kaat raha hai (din-ba-din)\n');
  await reset();
  const tp = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.ceo], title: 'Pending job' });
  await score(tp);
  for (const r of await rowsFor(U.e1, tp._id)) {
    console.log(`  ${r.earnedYMD}  ${n(r.points).padStart(4)}  ${r.reason}`);
  }
  console.log(`  ${'-'.repeat(50)}\n  TOTAL: ${n(await pts(U.e1, tp._id))}   (assigner ko: ${n(await pts(U.mgr, tp._id))} — kaam khatam hi nahi hua)`);

  // ════════════════ PART 3 — DO LOGON KO ASSIGN ════════════════
  console.log('\n\n### PART 3 — Ek hi kaam DO logon ko (E1 + E2). Har kisi ki apni copy.\n');
  console.log('  E1 ka haal   | E2 ka haal   ||     E1 |     E2 | ASSIGNER(Mgr) | assigner-entries');
  console.log('  ' + '-'.repeat(88));
  const pairs = [
    ['on-time', 'on-time'], ['on-time', 'late'], ['on-time', 'pending'],
    ['late', 'pending'], ['pending', 'pending'], ['late', 'late'],
  ];
  for (const [s1, s2] of pairs) {
    await reset();
    const batch = randomUUID();
    const mk = (owner, st) => mkTask({
      owner, assignedBy: U.mgr, tag: [U.ceo], batch,
      status: st === 'pending' ? 'PENDING' : 'DONE',
      completedAt: st === 'on-time' ? ONTIME : st === 'late' ? LATE : null,
    });
    const t1 = await mk(U.e1, s1);
    const t2 = await mk(U.e2, s2);
    // Asli zindagi jaisa: jo pehle khatam hua wo pehle score hota hai.
    for (const t of [t1, t2].sort((a, b) => (a.completedAt ? +a.completedAt : Infinity) - (b.completedAt ? +b.completedAt : Infinity))) await score(t);
    const p1 = await pts(U.e1, [t1._id, t2._id]);
    const p2 = await pts(U.e2, [t1._id, t2._id]);
    const pa = await pts(U.mgr, [t1._id, t2._id]);
    const nAsg = await PointEntry.countDocuments({ user: U.mgr._id, source: 'auto_assign' });
    console.log(`  ${s1.padEnd(12)} | ${s2.padEnd(12)} || ${n(p1).padStart(6)} | ${n(p2).padStart(6)} | ${n(pa).padStart(13)} | ${nAsg}`);
    if (nAsg > 1) flag('BLOCKER', `multi-assign me assigner ko ${nAsg} baar paisa mila (${s1}/${s2})`);
  }

  // ════════════════ PART 4 — MULTI-ASSIGN ka undo ════════════════
  console.log('\n\n### PART 4 — Multi-assign: jisne pehle kiya usne undo kar diya\n');
  await reset();
  {
    const batch = randomUUID();
    const t1 = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.ceo], batch, status: 'DONE', completedAt: ONTIME });
    const t2 = await mkTask({ owner: U.e2, assignedBy: U.mgr, tag: [U.ceo], batch, status: 'DONE', completedAt: LATE });
    await score(t1); await score(t2);
    console.log(`  dono done          → assigner: ${n(await pts(U.mgr, [t1._id, t2._id]))} (entries ${await PointEntry.countDocuments({ user: U.mgr._id, source: 'auto_assign' })})`);
    // E1 ne undo kiya
    await PointEntry.deleteMany({ taskRef: t1._id, source: { $in: ['auto_task', 'auto_forward', 'auto_assign'] } });
    await Task.updateOne({ _id: t1._id }, { status: 'PENDING', completedAt: null });
    await rebuildOverdueForTask(t1._id);
    const after = await pts(U.mgr, [t1._id, t2._id]);
    console.log(`  E1 ne undo kiya    → assigner: ${n(after)}  ${after === 0 ? '← anchor copy ke saath award bhi gir gaya' : ''}`);
    // Daily re-score (asli zindagi me roz chalta hai) — E2 abhi bhi DONE hai
    await onAssignedTaskDone(await Task.findById(t2._id));
    const healed = await pts(U.mgr, [t1._id, t2._id]);
    console.log(`  agle din re-score  → assigner: ${n(healed)}  ${healed === 3 ? '← wapas aa gaya (self-healing)' : '← WAPAS NAHI AAYA ❌'}`);
    if (healed !== 3) flag('HIGH', 'multi-assign: anchor copy undo hone par assigner ka +3 re-score se wapas nahi aata');
  }

  // ════════════════ PART 5 — APPROVAL GATE ════════════════
  console.log('\n\n### PART 5 — Approval wala task: submit ho gaya par approve nahi hua\n');
  await reset();
  {
    const t = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.ceo], requiresApproval: true, submittedAt: ONTIME });
    await score(t); // abhi PENDING hi hai (approval ka intezaar)
    console.log(`  E1 ne ${ONTIME} ko submit kiya, due ${DUE}, aaj ${TODAY} tak approve NAHI hua:`);
    for (const r of await rowsFor(U.e1, t._id)) console.log(`    ${r.earnedYMD}  ${n(r.points).padStart(4)}  ${r.reason}`);
    console.log(`    TOTAL E1: ${n(await pts(U.e1, t._id))}   | Manager (jisne approve nahi kiya): ${n(await pts(U.mgr, t._id))}`);
    flag('NOTE', 'approval-gated task me deri manager ki ho sakti hai, par penalty poori employee par girti hai');
  }

  // ════════════════ PART 6 — FORWARD CHAIN ════════════════
  console.log('\n\n### PART 6 — Forward chain: Manager → E1 → E2\n');
  console.log('  chain ka nateeja || E1 (forwarder) | E2 (doer) | ASSIGNER(Mgr)');
  console.log('  ' + '-'.repeat(70));
  for (const out of ['on-time', 'late', 'pending']) {
    await reset();
    const root = await mkTask({
      owner: U.e1, assignedBy: U.mgr, tag: [U.ceo],
      status: out === 'pending' ? 'PENDING' : 'DONE',
      completedAt: out === 'on-time' ? ONTIME : out === 'late' ? LATE : null,
    });
    const child = await mkTask({
      owner: U.e2, assignedBy: U.e1._id ? U.e1 : null, forwardedFrom: root._id,
      status: out === 'pending' ? 'PENDING' : 'DONE',
      completedAt: out === 'on-time' ? ONTIME : out === 'late' ? LATE : null,
    });
    await score(root);
    if (out === 'pending') {
      // Asli zindagi me roz ka scan chalta hai — wahi chala kar dekhte hain kis par girta hai.
      await maybeRunDaily(true);
      // ...aur rebuild (jo due-date badalne / undo par chalta hai) kya kehta hai
      await rebuildOverdueForTask(root._id);
      await rebuildOverdueForTask(child._id);
    }
    const ids = [root._id, child._id];
    console.log(`  ${out.padEnd(16)} || ${n(await pts(U.e1, ids)).padStart(14)} | ${n(await pts(U.e2, ids)).padStart(9)} | ${n(await pts(U.mgr, ids)).padStart(13)}`);
  }

  // ════════════════ PART 7 — KINARE KE CASE ════════════════
  console.log('\n\n### PART 7 — Kinare ke case (edge cases)\n');

  // 7a — apna khud ka task (kisi ne diya hi nahi)
  await reset();
  {
    const t = await mkTask({ owner: U.e1, assignedBy: null });
    await score(t);
    console.log(`  7a  apna personal task, due nikal gaya      → E1: ${n(await pts(U.e1, t._id))}  ${(await pts(U.e1, t._id)) === 0 ? '(sahi — apne task ke points nahi)' : '❌'}`);
  }

  // 7b — assigner ne khud ko bhi assign kiya (paidAsHolder)
  await reset();
  {
    const batch = randomUUID();
    const t = await mkTask({ owner: U.mgr, assignedBy: U.mgr, tag: [U.ceo], batch, status: 'DONE', completedAt: ONTIME });
    await score(t);
    const rows = await rowsFor(U.mgr, t._id);
    console.log(`  7b  Manager ne khud ko assign kiya          → Manager: ${n(await pts(U.mgr, t._id))} (${rows.map((r) => r.source).join('+') || 'kuch nahi'})`);
    if (rows.some((r) => r.source === 'auto_assign')) flag('HIGH', 'apne aap ko assign karke +3 aur +10 dono mil rahe hain');
  }

  // 7c — CEO ne khud ko assign kiya
  await reset();
  {
    const t = await mkTask({ owner: U.ceo, assignedBy: U.ceo, status: 'DONE', completedAt: ONTIME });
    await score(t);
    console.log(`  7c  CEO ne khud ko assign kiya              → CEO: ${n(await pts(U.ceo, t._id))}`);
  }

  // 7d — 1 Aug se pehle assign hua, ab jaake pura hua
  await reset();
  {
    const t = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.ceo], assignedOn: OLD_ASSIGNED, due: '2026-07-25', status: 'DONE', completedAt: ONTIME });
    await score(t);
    console.log(`  7d  ${OLD_ASSIGNED} ko assign (purana niyam)    → E1: ${n(await pts(U.e1, t._id))} | Manager: ${n(await pts(U.mgr, t._id))} ${(await pts(U.mgr, t._id)) === 0 ? '(grandfathered — sahi)' : '❌'}`);
  }

  // 7e — bina due date ka task (1 Aug ke baad)
  await reset();
  {
    const t = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.ceo], due: null, status: 'DONE', completedAt: ONTIME });
    await score(t);
    console.log(`  7e  bina due date, complete ho gaya         → E1: ${n(await pts(U.e1, t._id))} | Manager: ${n(await pts(U.mgr, t._id))} (dono sifar hone chahiye)`);
  }

  // 7f — chhutti/itwaar wale din drip
  await reset();
  {
    await Holiday.create({ title: 'Test Holiday', type: 'HOLIDAY', startYMD: '2026-09-04', endYMD: '2026-09-04', startDate: D('2026-09-04'), endDate: D('2026-09-04') });
    const t = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.ceo], due: '2026-09-01' });
    await score(t);
    const days = (await rowsFor(U.e1, t._id)).filter((r) => r.dedupeKey?.startsWith('auto_overdue'));
    console.log(`  7f  chhutti/itwaar: drip ke din             → ${days.map((r) => r.earnedYMD).join(', ') || 'koi nahi'}`);
    console.log(`      (due 1 Sep → 2 Sep par -5 ka nishaan, 3 Sep se roz -1. 4 Sep CHHUTTI aur 6 Sep ITWAAR list me nahi hone chahiye)`);
    if (days.some((r) => r.earnedYMD === '2026-09-06')) flag('BLOCKER', 'itwaar ko bhi drip lag raha hai');
    if (days.some((r) => r.earnedYMD === '2026-09-04')) flag('BLOCKER', 'chhutti ke din bhi drip lag raha hai');
    await Holiday.deleteMany({});
  }

  // 7g — tag hatane par purane points wapas
  await reset();
  {
    const t = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.ceo], status: 'DONE', completedAt: LATE });
    await score(t);
    const before = await pts(U.e1, t._id);
    await Task.updateOne({ _id: t._id }, { collaborators: [] });
    await onAssignedTaskDone(await Task.findById(t._id));
    const after = await pts(U.e1, t._id);
    console.log(`  7g  CEO ka tag hata diya                    → pehle ${n(before)}, ab ${n(after)} ${after === 0 ? '(penalty maaf ho gayi)' : ''}`);
    flag('NOTE', 'CEO ka tag hatate hi lagi hui penalty poori maaf ho jaati hai — koi bhi assigner ye kar sakta hai');
  }

  // 7h — preview kya kehta hai vs ledger
  await reset();
  {
    const t = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.ceo] });
    await score(t);
    const pv = await taskBonusPreview(t._id);
    const shown = (pv?.earnedSoFar || 0) - (pv?.deductedSoFar || 0);
    const real = await pts(U.e1, t._id);
    console.log(`  7h  preview vs ledger                       → preview: ${n(shown)} | ledger: ${n(real)} ${shown === real ? '(match)' : '❌ MISMATCH'}`);
    if (shown !== real) flag('HIGH', 'task preview aur asli ledger alag-alag bata rahe hain');
  }

  // 7i — jisko kaam mila WOHI tag bhi hai (purana data / seedha DB edit)
  await reset();
  {
    const t = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.e1, U.ceo], status: 'DONE', completedAt: ONTIME });
    await score(t);
    const rows = await rowsFor(U.e1, t._id);
    console.log(`  7i  doer khud hi tag me bhi hai             → E1: ${n(await pts(U.e1, t._id))} (${rows.length} entry) ${rows.length === 1 ? '(double nahi hua — sahi)' : '❌ DOUBLE'}`);
    if (rows.length > 1) flag('BLOCKER', 'doer agar khud tag me ho to use do baar points mil rahe hain');
  }

  // 7j — batch me sirf EK copy par CEO ka tag
  await reset();
  {
    const batch = randomUUID();
    const t1 = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.ceo], batch, status: 'DONE', completedAt: ONTIME });
    const t2 = await mkTask({ owner: U.e2, assignedBy: U.mgr, tag: [], batch, status: 'DONE', completedAt: ONTIME });
    await score(t1); await score(t2);
    console.log(`  7j  batch: sirf E1 ki copy par CEO ka tag   → E1: ${n(await pts(U.e1, [t1._id, t2._id]))} | E2: ${n(await pts(U.e2, [t1._id, t2._id]))} (ek hi kaam, alag nateeja)`);
    if ((await pts(U.e2, [t1._id, t2._id])) === 0) flag('NOTE', 'ek hi batch me tag sirf ek copy par ho to doosre bande ko kuch nahi milta — ek hi kaam, do alag nateeje');
  }

  // 7k — due date abhi aayi hi nahi
  await reset();
  {
    const t = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.ceo], due: '2026-12-31' });
    await score(t);
    console.log(`  7k  due date abhi door hai (31 Dec)         → E1: ${n(await pts(U.e1, t._id))} ${(await pts(U.e1, t._id)) === 0 ? '(sahi)' : '❌'}`);
  }

  // 7l — task hi delete ho gaya, points ka kya
  await reset();
  {
    const t = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.ceo], status: 'DONE', completedAt: LATE });
    await score(t);
    const before = await pts(U.e1, t._id);
    await Task.deleteOne({ _id: t._id });
    const after = await PointEntry.countDocuments({ taskRef: t._id });
    console.log(`  7l  task delete ho gaya                     → pehle ${n(before)}, delete ke baad ledger me ${after} entry bachi ${after ? '(pruneOrphanTaskEntries se hi hatengi)' : ''}`);
  }

  // 7m — multi-assign: jisne pehle kiya uski copy hi delete ho gayi
  await reset();
  {
    const batch = randomUUID();
    const t1 = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.ceo], batch, status: 'DONE', completedAt: ONTIME });
    const t2 = await mkTask({ owner: U.e2, assignedBy: U.mgr, tag: [U.ceo], batch, status: 'DONE', completedAt: LATE });
    await score(t1); await score(t2);
    await Task.deleteOne({ _id: t1._id });
    await PointEntry.deleteMany({ taskRef: t1._id });
    await onAssignedTaskDone(await Task.findById(t2._id)); // agla re-score
    const asg = await PointEntry.countDocuments({ user: U.mgr._id, source: 'auto_assign' });
    console.log(`  7m  batch: pehli copy delete ho gayi        → assigner ke paas ${asg} reward entry ${asg === 1 ? '(sahi — dobara ban gayi)' : asg === 0 ? '❌ kho gayi' : '❌ double'}`);
    if (asg !== 1) flag('HIGH', `batch ki anchor copy delete hone par assigner ka reward ${asg === 0 ? 'gayab ho jata hai' : 'double ho jata hai'}`);
  }

  // 7n — due-date lock ke bawajood, tag hata kar penalty maaf karayi ja sakti hai?
  await reset();
  {
    const t = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.ceo], due: '2026-08-05', title: 'Purana atka kaam' });
    await score(t);
    const before = await pts(U.e1, t._id);
    // Manager (owner-tier NAHI) CEO ka tag hata deta hai — due date to lock hai, par ye khula hai
    await Task.updateOne({ _id: t._id }, { collaborators: [] });
    await rebuildOverdueForTask(t._id);
    const afterUntag = await pts(U.e1, t._id);
    // aur wapas tag kar diya
    await Task.updateOne({ _id: t._id }, { collaborators: [U.ceo._id] });
    await rebuildOverdueForTask(t._id);
    const afterRetag = await pts(U.e1, t._id);
    console.log(`  7n  PENDING task, tag hataya-lagaya           → pehle ${n(before)} → tag hata kar ${n(afterUntag)} → wapas laga kar ${n(afterRetag)}`);
    if (afterUntag !== before) flag('HIGH', `due-date lock hone ke bawajood CEO ka tag hata kar lagi hui penalty (${n(before)} → ${n(afterUntag)}) badli ja sakti hai — assigner khud kar sakta hai`);
    else console.log(`      (tag hatane se PENDING task ki purani penalty nahi hati — sirf aage badhna ruk jata)`);
  }

  // ════════════════ PART 8 — MAHINA BADALNE PAR ════════════════
  console.log(`

### PART 8 — Task ek mahine me atka, agle mahine tak chalta raha
`);
  await reset();
  {
    const t = await mkTask({ owner: U.e1, assignedBy: U.mgr, tag: [U.ceo], due: '2026-08-05', title: 'August ka atka kaam' });
    await score(t);
    const rows = await rowsFor(U.e1, t._id);
    const byMonth = {};
    for (const r of rows) byMonth[r.month] = (byMonth[r.month] || 0) + r.points;
    console.log(`  (a) 5 Aug due, aaj tak PENDING:`);
    for (const [m, v] of Object.entries(byMonth)) console.log(`        ${m}: ${n(v)}  (${rows.filter((r) => r.month === m).length} entry)`);
    console.log(`        TOTAL: ${n(rows.reduce((a, r) => a + r.points, 0))}`);

    // ab ye task aaj se pehle wale din LATE complete hua
    await PointEntry.deleteMany({ taskRef: t._id });
    await Task.updateOne({ _id: t._id }, { status: 'DONE', completedAt: D('2026-09-07'), completedBy: U.e1._id });
    const fin = await Task.findById(t._id);
    await rebuildOverdueForTask(fin._id);       // roz ka drip jo lag chuka tha
    await onAssignedTaskDone(fin);              // aur ab final nateeja
    const rows2 = await rowsFor(U.e1, fin._id);
    const byMonth2 = {};
    for (const r of rows2) byMonth2[r.month] = (byMonth2[r.month] || 0) + r.points;
    console.log(`
  (b) wahi task 7 Sep ko LATE complete hua:`);
    for (const [m, v] of Object.entries(byMonth2)) console.log(`        ${m}: ${n(v)}  (${rows2.filter((r) => r.month === m).length} entry)`);
    console.log(`        TOTAL: ${n(rows2.reduce((a, r) => a + r.points, 0))}`);
    const mark = rows2.find((r) => r.dedupeKey?.startsWith('auto_task:'));
    console.log(`
  → -5 ka nishaan kis mahine me gira? ${mark?.month} (${mark?.earnedYMD})  ${mark?.month === '2026-08' ? '← August me hi, sahi' : '❌ September me khisak gaya'}`);
    console.log(`  → assigner ko: ${n(await pts(U.mgr, fin._id))} (September me, kyunki kaam ab poora hua)`);
    if (mark?.month !== '2026-08') flag('BLOCKER', 'late complete karne par -5 ka nishaan agle mahine me khisak raha hai');
  }

  // ════════════════ NATEEJA ════════════════
  console.log(`\n\n${'='.repeat(96)}\nFINDINGS\n${'='.repeat(96)}`);
  if (!findings.length) console.log('  (koi blocker nahi)');
  for (const f of findings) console.log('  ' + f);
  console.log('');

  await mongoose.connection.dropDatabase();
  await disconnectDB();
}

main().catch((e) => { console.error(e); process.exit(1); });
