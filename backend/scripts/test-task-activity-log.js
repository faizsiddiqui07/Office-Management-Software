/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * Activity log me task ka poora safar record hona chahiye. Pehle sirf CREATE aur FORWARD
 * likhe jaate the — update, delete, done/undone aur approve/reject kahin nahi jaate the,
 * yaani kisi ne task chupchaap badal ya mita diya to koi nishaan hi nahi bachta tha.
 *
 * Ye test CONTROLLER ke asli raaste se chalta hai (nakli req/res), kyunki audit ki line
 * controller me hai — sirf service bulane se wo chalti hi nahi aur test jhootha pass ho
 * jaata.
 *
 * Run (backend folder se):  node scripts/test-task-activity-log.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_activitylog'; // throwaway DB
process.env.APP_LIVE_YMD = '2026-07-01';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Task } from '../src/models/Task.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { loadRoles } from '../src/lib/roles.js';
import * as ctrl from '../src/controllers/tasks.controller.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}

/** Nakli res — controller isi par likhta hai. */
function mkRes() {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
/** Ek controller call, jaise asli request aayi ho. */
async function call(fn, { user, params = {}, body = {} }) {
  const res = mkRes();
  let nextErr = null;
  await fn({ user, params, body }, res, (e) => { nextErr = e; });
  if (nextErr) throw nextErr;
  return res;
}
/** Sabse naya audit row is action ka. */
const logOf = (action) => AuditLog.findOne({ action }).sort({ createdAt: -1 }).lean();
const countOf = (action) => AuditLog.countDocuments({ action });

let boss, emp, emp2;

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO & President', rank: 0, permissions: ['markAttendance'], isSystem: true },
    { key: 'TEAM', label: 'Team', rank: 40, permissions: ['markAttendance'], isSystem: true },
  ]);
  await loadRoles();
  await Setting.create({ key: 'global', companyName: 'TestCo', weekendDays: [0], bonus: { enabled: false } });
  Setting.invalidateCache();

  boss = await User.create({ name: 'Khaan Aamir', email: 'b@t.co', passwordHash: 'x', role: 'CEO_PRESIDENT', employeeId: 'L-B', isActive: true, taskAssign: { mode: 'ALL', users: [] } });
  emp = await User.create({ name: 'Mariya Khan', email: 'e@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'L-E', isActive: true });
  emp2 = await User.create({ name: 'Naimish Saini', email: 'e2@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'L-E2', isActive: true, taskAssign: { mode: 'ALL', users: [] } });

  // ═══ TEST 1 — CREATE (pehle se tha, tootna nahi chahiye) ═══
  console.log('TEST 1 — task banane ka record (purana behaviour)');
  const created = await call(ctrl.create, {
    user: boss,
    body: { title: 'Site survey', dueYMD: '2026-12-31', assignTo: String(emp._id) },
  });
  const taskId = created.body?.data?.task?.id;
  check('task ban gaya', !!taskId, created.body?.error?.message || '');
  check('task.create likha gaya', (await countOf('task.create')) === 1);

  // ═══ TEST 2 — UPDATE (yahi maang thi) ═══
  console.log('\nTEST 2 — task badalne ka record');
  await call(ctrl.update, { user: boss, params: { id: taskId }, body: { title: 'Site survey (revised)', notes: 'bring tape' } });
  const upd = await logOf('task.update');
  check('task.update likha gaya', !!upd);
  check('kis task par, naam ke saath', upd?.meta?.title === 'Site survey (revised)', upd?.meta?.title);
  check('KYA badla wo bhi likha', Array.isArray(upd?.meta?.fields) && upd.meta.fields.includes('title') && upd.meta.fields.includes('notes'),
    JSON.stringify(upd?.meta?.fields));
  check('actor sahi', String(upd?.actor) === String(boss._id));
  check('entityId sahi', String(upd?.entityId) === String(taskId));

  // ═══ TEST 3 — STATUS ═══
  console.log('\nTEST 3 — done / not-done ka record');
  await call(ctrl.setStatus, { user: emp, params: { id: taskId }, body: { status: 'DONE' } });
  const doneLog = await logOf('task.status');
  check('task.status likha gaya', !!doneLog);
  check('status DONE', doneLog?.meta?.status === 'DONE', doneLog?.meta?.status);
  check('karne wala Mariya', String(doneLog?.actor) === String(emp._id));
  await call(ctrl.setStatus, { user: emp, params: { id: taskId }, body: { status: 'PENDING' } });
  check('wapas kholne ka bhi alag record', (await countOf('task.status')) === 2, `got ${await countOf('task.status')}`);
  check('doosre record me PENDING', (await logOf('task.status'))?.meta?.status === 'PENDING');

  // ═══ TEST 4 — APPROVAL wala task: "done" asal me SUBMIT hai ═══
  console.log('\nTEST 4 — approval wale task me "done" ka matlab SUBMIT, aur log wahi kahe');
  const ap = await call(ctrl.create, {
    user: boss,
    body: { title: 'Tender file', dueYMD: '2026-12-31', assignTo: String(emp._id), requiresApproval: true },
  });
  const apId = ap.body?.data?.task?.id;
  await call(ctrl.setStatus, { user: emp, params: { id: apId }, body: { status: 'DONE' } });
  const sub = await logOf('task.status');
  check('log me SUBMITTED likha hai, DONE nahi', sub?.meta?.status === 'SUBMITTED', sub?.meta?.status);

  // ═══ TEST 5 — APPROVE / REJECT ═══
  console.log('\nTEST 5 — approve aur wapas bhejne ka record');
  await call(ctrl.review, { user: boss, params: { id: apId }, body: { approve: false, reason: 'measurements adhoore' } });
  const rej = await logOf('task.reject');
  check('task.reject likha gaya', !!rej);
  check('wajah bhi likhi', rej?.meta?.reason === 'measurements adhoore', rej?.meta?.reason);
  check('kiska kaam tha wo bhi', rej?.meta?.owner === 'Mariya Khan', rej?.meta?.owner);

  await call(ctrl.setStatus, { user: emp, params: { id: apId }, body: { status: 'DONE' } }); // dobara submit
  await call(ctrl.review, { user: boss, params: { id: apId }, body: { approve: true } });
  const app = await logOf('task.approve');
  check('task.approve likha gaya', !!app);
  check('byAssigner = true (khud dene wale ne approve kiya)', app?.meta?.byAssigner === true, String(app?.meta?.byAssigner));
  check('approve aur reject alag-alag action hain', (await countOf('task.approve')) === 1 && (await countOf('task.reject')) === 1);

  // ═══ TEST 6 — DELETE (yahi doosri maang thi) ═══
  console.log('\nTEST 6 — task mitane ka record');
  await call(ctrl.remove, { user: boss, params: { id: taskId } });
  const del = await logOf('task.delete');
  check('task.delete likha gaya', !!del);
  check('mite hue task ka NAAM log me hai', del?.meta?.title === 'Site survey (revised)', del?.meta?.title);
  check('kiska task tha wo bhi', del?.meta?.owner === 'Mariya Khan', del?.meta?.owner);
  check('task sach me mit gaya', !(await Task.findById(taskId)));

  // ═══ TEST 7 — forward ki hui copies bhi ginayi jayein ═══
  console.log('\nTEST 7 — forward ki hui copy ke saath delete');
  const f = await call(ctrl.create, { user: boss, body: { title: 'Ledger work', dueYMD: '2026-12-31', assignTo: String(emp2._id) } });
  const fId = f.body?.data?.task?.id;
  await call(ctrl.forward, { user: emp2, params: { id: fId }, body: { assignTo: String(emp._id) } });
  await call(ctrl.remove, { user: boss, params: { id: fId } });
  const del2 = await logOf('task.delete');
  check('saath gayi copies ki ginti bhi log me', del2?.meta?.cascaded === 1, String(del2?.meta?.cascaded));

  // ═══ TEST 8 — CONTROL: padhne wali cheezein log me shor na machayein ═══
  console.log('\nTEST 8 — CONTROL: sirf khol kar dekhne se koi entry na bane');
  const before = await AuditLog.countDocuments();
  const s2 = await call(ctrl.create, { user: boss, body: { title: 'Seen test', dueYMD: '2026-12-31', assignTo: String(emp._id) } });
  await call(ctrl.seen, { user: emp, params: { id: s2.body?.data?.task?.id }, body: {} });
  check('read-receipt ne koi audit row nahi banayi', (await AuditLog.countDocuments()) === before + 1,
    `${before} → ${await AuditLog.countDocuments()} (sirf task.create badhna chahiye)`);

  console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PASS'}\n`);
  await mongoose.connection.dropDatabase();
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
