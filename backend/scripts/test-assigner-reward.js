/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI). Verifies the assigner
 * reward (+3 to whoever hands work out) and the due-date lock.
 *
 * Run (backend folder se):  node scripts/test-assigner-reward.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_assigner'; // throwaway DB
process.env.APP_LIVE_YMD = '2026-07-01';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { Task } from '../src/models/Task.js';
import { loadRoles } from '../src/lib/roles.js';
import { onAssignedTaskDone, onAssignedTaskUndone, maybeRunDaily } from '../src/services/bonus.service.js';
import { updateTask } from '../src/services/task.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}

/** Points a user got from one task (by source). */
async function ptsFor(userId, taskId, source) {
  const rows = await PointEntry.find({ user: userId, taskRef: taskId, ...(source ? { source } : {}) });
  return rows.reduce((s, r) => s + r.points, 0);
}
async function entryFor(userId, taskId, source) {
  return PointEntry.findOne({ user: userId, taskRef: taskId, source });
}

const D = (ymd) => new Date(`${ymd}T06:00:00Z`);

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  // Roles: owner tier = lowest rank. CEO_PRESIDENT rank 0, others higher.
  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO & President', rank: 0, permissions: ['markAttendance'], isSystem: true },
    { key: 'MANAGER', label: 'Manager', rank: 20, permissions: ['markAttendance'], isSystem: true },
    { key: 'EMPLOYEE', label: 'Employee', rank: 50, permissions: ['markAttendance'], isSystem: true },
  ]);
  await loadRoles();

  // PROD JAISA setup: rateHistory MAUJOOD hai (go-live pe seed hua tha) aur usme
  // assignTaskDone NAHI hai — bilkul asli DB jaisa. Pehle test isme rateHistory tha hi
  // nahi, isliye asli bug (rule 0 pe price hota tha) chhup gaya tha.
  const BASE_RULES = [
    { key: 'assignedTaskOnTime', points: 10 },
    { key: 'assignedTaskLate', points: 5 },
    { key: 'forwardOnTime', points: 3 },
    { key: 'forwardLate', points: 2 },
  ];
  await Setting.create({
    key: 'global',
    companyName: 'TestCo',
    weekendDays: [0],
    bonus: {
      enabled: true,
      rupeesPerPoint: 0,
      graceDays: 0,
      autoRules: [...BASE_RULES],
      rateHistory: [{ effectiveFrom: '2026-07-01', graceDays: 0, rules: [...BASE_RULES], changedBy: null, changedAt: new Date() }],
      lastPenaltyRun: '2026-08-24',
      lastMonthRollup: '2026-07',
      lastAbsenceScan: '2026-08-24',
      historyScored: '2026-07',
      lastStreakScan: '2026-08-23',
    },
  });
  Setting.invalidateCache();

  const ceo = await User.create({ name: 'Boss', email: 'boss@t.co', passwordHash: 'x', role: 'CEO_PRESIDENT', employeeId: 'T-CEO', isActive: true });
  const mgr = await User.create({ name: 'Manager', email: 'mgr@t.co', passwordHash: 'x', role: 'MANAGER', employeeId: 'T-MGR', isActive: true });
  const emp = await User.create({ name: 'Worker', email: 'w@t.co', passwordHash: 'x', role: 'EMPLOYEE', employeeId: 'T-EMP', isActive: true });
  const emp2 = await User.create({ name: 'Worker2', email: 'w2@t.co', passwordHash: 'x', role: 'EMPLOYEE', employeeId: 'T-EMP2', isActive: true });

  // ═══ TEST 0 — asli rollout path: seed rule ko rateHistory me daalta hai + flags tikte hain ═══
  console.log('TEST 0 — rollout (maybeRunDaily): rule seed + flags persist?');
  await maybeRunDaily(true);
  Setting.invalidateCache();
  let cfg = await Setting.findOne({ key: 'global' }).lean();
  check('rule autoRules me aaya', (cfg.bonus.autoRules || []).some((r) => r.key === 'assignTaskDone'));
  const histHas = (cfg.bonus.rateHistory || []).some((h) => h.effectiveFrom >= '2026-08-01' && (h.rules || []).some((r) => r.key === 'assignTaskDone'));
  check('rule rateHistory me BHI aaya (asli bug yahi tha)', histHas,
    (cfg.bonus.rateHistory || []).map((h) => h.effectiveFrom).join(', '));
  check('July wale purane snapshot me rule NAHI ghusa', !(cfg.bonus.rateHistory || []).find((h) => h.effectiveFrom === '2026-07-01')?.rules?.some((r) => r.key === 'assignTaskDone'));
  check('baaki rules ka daam nahi badla', (cfg.bonus.rateHistory || []).every((h) => (h.rules || []).filter((r) => r.key === 'assignedTaskOnTime').every((r) => r.points === 10)));
  check('flag assignerRewardSeeded DB me tika', cfg.bonus.assignerRewardSeeded === true, `got ${cfg.bonus.assignerRewardSeeded}`);
  check('flag assignerRewardV1 DB me tika', cfg.bonus.assignerRewardV1 === true, `got ${cfg.bonus.assignerRewardV1}`);
  check('flag overdueSkipOffDaysV1 DB me tika', cfg.bonus.overdueSkipOffDaysV1 === true, `got ${cfg.bonus.overdueSkipOffDaysV1}`);



  // ═══ TEST 1 — assigner ko +3, doer ko +10, dono usi din ═══
  console.log('TEST 1 — on-time task: doer +10, assigner +3, same day?');
  const t1 = await Task.create({
    title: 'On-time job', owner: emp._id, assignedBy: mgr._id, collaborators: [ceo._id],
    dueYMD: '2026-08-20', status: 'DONE', completedAt: D('2026-08-18'), createdAt: D('2026-08-10'),
  });
  await onAssignedTaskDone(t1);
  const doer1 = await entryFor(emp._id, t1._id, 'auto_task');
  const asg1 = await entryFor(mgr._id, t1._id, 'auto_assign');
  check('doer ko +10', doer1?.points === 10, `got ${doer1?.points}`);
  check('assigner (Manager) ko +3', asg1?.points === 3, `got ${asg1?.points}`);
  check('dono ka earnedYMD same', doer1?.earnedYMD === asg1?.earnedYMD, `doer=${doer1?.earnedYMD} assigner=${asg1?.earnedYMD}`);
  check('dono ka month same', doer1?.month === asg1?.month, `${doer1?.month} vs ${asg1?.month}`);

  // ═══ TEST 2 — LATE hone pe bhi assigner ko +3 (penalty kabhi nahi) ═══
  console.log('\nTEST 2 — late task: doer -5, assigner phir bhi +3?');
  const t2 = await Task.create({
    title: 'Late job', owner: emp._id, assignedBy: mgr._id, collaborators: [ceo._id],
    dueYMD: '2026-08-05', status: 'DONE', completedAt: D('2026-08-18'), createdAt: D('2026-08-02'),
  });
  await onAssignedTaskDone(t2);
  const doer2 = await entryFor(emp._id, t2._id, 'auto_task');
  const asg2 = await entryFor(mgr._id, t2._id, 'auto_assign');
  check('doer ko -5 (late)', doer2?.points === -5, `got ${doer2?.points}`);
  check('assigner ko +3 (POSITIVE, late hone pe bhi)', asg2?.points === 3, `got ${asg2?.points}`);
  check('assigner ka koi negative entry nahi', (await ptsFor(mgr._id, t2._id)) === 3, `total ${await ptsFor(mgr._id, t2._id)}`);

  // ═══ TEST 3 — 1 Aug se pehle assign hua task → assigner ko kuch nahi ═══
  console.log('\nTEST 3 — July me assign hua task (grandfathered)?');
  const t3 = await Task.create({
    title: 'July job', owner: emp._id, assignedBy: mgr._id, collaborators: [ceo._id],
    dueYMD: '2026-08-20', status: 'DONE', completedAt: D('2026-08-18'), createdAt: D('2026-07-25'),
  });
  await onAssignedTaskDone(t3);
  check('assigner ko kuch NAHI (July assign)', (await entryFor(mgr._id, t3._id, 'auto_assign')) === null);
  check('doer ko phir bhi +10', (await entryFor(emp._id, t3._id, 'auto_task'))?.points === 10);

  // ═══ TEST 4 — CEO/President tag nahi → kisi ko kuch nahi ═══
  console.log('\nTEST 4 — CEO/President tag nahi kiya?');
  const t4 = await Task.create({
    title: 'Untagged job', owner: emp._id, assignedBy: mgr._id, collaborators: [],
    dueYMD: '2026-08-20', status: 'DONE', completedAt: D('2026-08-18'), createdAt: D('2026-08-10'),
  });
  await onAssignedTaskDone(t4);
  check('assigner ko kuch nahi', (await entryFor(mgr._id, t4._id, 'auto_assign')) === null);
  check('doer ko bhi kuch nahi', (await entryFor(emp._id, t4._id, 'auto_task')) === null);

  // ═══ TEST 5 — CEO khud task de → CEO ko bhi +3 ═══
  console.log('\nTEST 5 — CEO khud task de (tag ki zaroorat nahi)?');
  const t5 = await Task.create({
    title: 'CEO job', owner: emp._id, assignedBy: ceo._id, collaborators: [],
    dueYMD: '2026-08-20', status: 'DONE', completedAt: D('2026-08-18'), createdAt: D('2026-08-10'),
  });
  await onAssignedTaskDone(t5);
  check('CEO ko +3', (await entryFor(ceo._id, t5._id, 'auto_assign'))?.points === 3);
  check('doer ko +10', (await entryFor(emp._id, t5._id, 'auto_task'))?.points === 10);

  // ═══ TEST 6 — forward chain: assigner ko sirf EK BAAR, forwarder ko apna rule ═══
  console.log('\nTEST 6 — forward chain (CEO → emp → emp2): double-pay to nahi?');
  const root = await Task.create({
    title: 'Chain job', owner: emp._id, assignedBy: ceo._id, collaborators: [],
    dueYMD: '2026-08-20', status: 'DONE', completedAt: D('2026-08-18'), createdAt: D('2026-08-10'),
  });
  const child = await Task.create({
    title: 'Chain job', owner: emp2._id, assignedBy: emp._id, forwardedFrom: root._id,
    dueYMD: '2026-08-20', status: 'DONE', completedAt: D('2026-08-18'), createdAt: D('2026-08-11'),
  });
  await onAssignedTaskDone(root);
  const ceoRows = await PointEntry.find({ user: ceo._id, taskRef: root._id, source: 'auto_assign' });
  check('CEO ko sirf 1 assigner-entry', ceoRows.length === 1, `got ${ceoRows.length}`);
  check('CEO ko +3', ceoRows[0]?.points === 3, `got ${ceoRows[0]?.points}`);
  check('forwarder (emp) ko forwardOnTime +3', (await entryFor(emp._id, root._id, 'auto_forward'))?.points === 3);
  check('forwarder ko assigner-reward NAHI (double-pay nahi)', (await entryFor(emp._id, child._id, 'auto_assign')) === null);
  check('doer (emp2) ko +10', (await entryFor(emp2._id, child._id, 'auto_task'))?.points === 10);

  // ═══ TEST 6b — multi-assign: ek kaam 2 logon ko → assigner ko +3 SIRF EK BAAR ═══
  console.log('\nTEST 6b — ek kaam 2 logon ko (batch): +3 sirf ek baar?');
  const BATCH = 'batch-xyz-1';
  const b1 = await Task.create({
    title: 'Site visit', owner: emp._id, assignedBy: mgr._id, collaborators: [ceo._id], assignBatch: BATCH,
    dueYMD: '2026-08-20', status: 'DONE', completedAt: D('2026-08-16'), createdAt: D('2026-08-10'),
  });
  const b2 = await Task.create({
    title: 'Site visit', owner: emp2._id, assignedBy: mgr._id, collaborators: [ceo._id], assignBatch: BATCH,
    dueYMD: '2026-08-20', status: 'DONE', completedAt: D('2026-08-18'), createdAt: D('2026-08-10'),
  });
  await onAssignedTaskDone(b1);
  await onAssignedTaskDone(b2);
  const batchRows = await PointEntry.find({ user: mgr._id, source: 'auto_assign', taskRef: { $in: [b1._id, b2._id] } });
  check('assigner ko batch pe SIRF 1 entry', batchRows.length === 1, `got ${batchRows.length}`);
  check('wo entry +3 hai (na ki +6)', batchRows.reduce((s, r) => s + r.points, 0) === 3, `got ${batchRows.reduce((s, r) => s + r.points, 0)}`);
  check('entry pehle-complete hue copy pe hai', String(batchRows[0]?.taskRef) === String(b1._id), 'anchor = jo pehle done hua');
  check('dono doers ko apna +10 mila', (await entryFor(emp._id, b1._id, 'auto_task'))?.points === 10 && (await entryFor(emp2._id, b2._id, 'auto_task'))?.points === 10);
  // Ulta order me dobara score karo — phir bhi 1 hi entry rehni chahiye (idempotent)
  await onAssignedTaskDone(b2);
  await onAssignedTaskDone(b1);
  const batchRows2 = await PointEntry.find({ user: mgr._id, source: 'auto_assign', taskRef: { $in: [b1._id, b2._id] } });
  check('dobara score karne pe bhi 1 hi entry', batchRows2.length === 1, `got ${batchRows2.length}`);

  // ═══ TEST 7 — task un-done → assigner reward bhi hat jaye ═══
  console.log('\nTEST 7 — task un-done hua to assigner reward hatta hai?');
  await onAssignedTaskUndone(t1._id);
  check('assigner reward hat gaya', (await entryFor(mgr._id, t1._id, 'auto_assign')) === null);

  // ═══ TEST 8 — DUE DATE LOCK ═══
  console.log('\nTEST 8 — due-date lock');
  const lockT = await Task.create({
    title: 'Locked job', owner: emp._id, assignedBy: mgr._id, collaborators: [ceo._id],
    dueYMD: '2026-08-28', status: 'PENDING', createdAt: D('2026-08-10'),
  });
  // (a) normal assigner aage nahi badha sakta
  let err = null;
  try { await updateTask(mgr, String(lockT._id), { dueYMD: '2026-09-05' }); } catch (e) { err = e; }
  check('assigner date AAGE nahi badha saka (403)', err?.status === 403 && err?.code === 'DUE_DATE_LOCKED', `got ${err?.code || 'no error'}`);
  // (b) peeche bhi nahi
  err = null;
  try { await updateTask(mgr, String(lockT._id), { dueYMD: '2026-08-25' }); } catch (e) { err = e; }
  check('assigner date PEECHE bhi nahi kar saka (403)', err?.status === 403, `got ${err?.code || 'no error'}`);
  // (c) date wahi bhejna allowed (koi change nahi)
  err = null;
  try { await updateTask(mgr, String(lockT._id), { dueYMD: '2026-08-28', title: 'Locked job v2' }); } catch (e) { err = e; }
  check('wahi date + title edit allowed', err === null, `got ${err?.code || 'ok'}`);
  check('title update hua', (await Task.findById(lockT._id))?.title === 'Locked job v2');
  // (d) CEO KISI AUR ke assign kiye task ko edit hi nahi kar sakta — ye app ka PURANA rule
  //     hai (delegated task sirf assigner edit karta hai), mere lock se pehle lagta hai.
  err = null;
  try { await updateTask(ceo, String(lockT._id), { dueYMD: '2026-09-05' }); } catch (e) { err = e; }
  check('CEO doosre ke task ko edit nahi kar sakta (purana rule)', err?.code === 'ASSIGNED_TASK', `got ${err?.code || 'no error'}`);

  // (d2) CEO APNE assign kiye task ki date badal sakta hai — yahi owner's rule hai.
  const ceoTask = await Task.create({
    title: 'CEO owned job', owner: emp._id, assignedBy: ceo._id, collaborators: [],
    dueYMD: '2026-08-28', status: 'PENDING', createdAt: D('2026-08-10'),
  });
  err = null;
  try { await updateTask(ceo, String(ceoTask._id), { dueYMD: '2026-09-05' }); } catch (e) { err = e; }
  check('CEO ne APNE task ki date aage badhai — allowed', err === null, `got ${err?.code || 'ok'}`);
  check('date sach me badli', (await Task.findById(ceoTask._id))?.dueYMD === '2026-09-05');

  // (e) July wala task (grandfathered) — assigner badal sakta hai
  const oldT = await Task.create({
    title: 'Old job', owner: emp._id, assignedBy: mgr._id, collaborators: [ceo._id],
    dueYMD: '2026-08-28', status: 'PENDING', createdAt: D('2026-07-20'),
  });
  err = null;
  try { await updateTask(mgr, String(oldT._id), { dueYMD: '2026-09-05' }); } catch (e) { err = e; }
  check('July wale task ki date assigner badal saka (grandfathered)', err === null, `got ${err?.code || 'ok'}`);

  // (f) personal task (kisi ne assign nahi kiya) — owner freely badal sake
  const personal = await Task.create({ title: 'My own', owner: emp._id, dueYMD: '2026-08-28', status: 'PENDING', createdAt: D('2026-08-10') });
  err = null;
  try { await updateTask(emp, String(personal._id), { dueYMD: '2026-09-05' }); } catch (e) { err = e; }
  check('personal task ki date owner badal saka', err === null, `got ${err?.code || 'ok'}`);

  // ═══ TEST 9 — flags sach me kaam karte hain: dobara tick pe kuch na ho ═══
  console.log('\nTEST 9 — CEO rule hata de to wapas to nahi aata?');
  await Setting.updateOne({ key: 'global' }, { $pull: { 'bonus.autoRules': { key: 'assignTaskDone' } } });
  Setting.invalidateCache();
  await maybeRunDaily(true); // agla scheduler tick
  Setting.invalidateCache();
  const cfg9 = await Setting.findOne({ key: 'global' }).lean();
  check('hataya hua rule WAPAS NAHI aaya', !(cfg9.bonus.autoRules || []).some((r) => r.key === 'assignTaskDone'),
    'seed dobara nahi chala — flag kaam kar raha hai');
  // Asli invariant: ek task pe ek hi assigner-entry, aur ek batch pe bhi ek hi.
  // (Daily re-sync jaan-boojh ke DONE tasks ke award dobara bana deta hai — wo sahi hai,
  //  bas DUPLICATE nahi banne chahiye.)
  const dupes = await PointEntry.aggregate([
    { $match: { source: 'auto_assign' } },
    { $group: { _id: '$taskRef', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  check('kisi bhi task pe duplicate assigner-entry nahi', dupes.length === 0, `dupes=${dupes.length}`);
  const batchRows9 = await PointEntry.find({ source: 'auto_assign', taskRef: { $in: [b1._id, b2._id] } });
  check('batch pe dobara tick ke baad bhi 1 hi entry', batchRows9.length === 1, `got ${batchRows9.length}`);

  await mongoose.connection.dropDatabase();
  await disconnectDB();
  console.log(`\n${failures === 0 ? '🎉 ALL PASS' : `💥 ${failures} FAIL`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('Test crashed:', err); process.exit(1); });
