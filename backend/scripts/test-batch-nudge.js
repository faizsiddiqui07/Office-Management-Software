/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * Kya check kar rahe hain: ek hi kaam jab kai logon ko assign hota hai to sabki apni
 * alag copy banti hai aur har koi apni copy tick karta hai. Ye jaan-boojh kar aisa hai,
 * par pehle CHUPCHAAP hota tha — ek banda kar deta, kaam nipta hua lagta, aur jo copy
 * khuli padi thi uspe roz ki penalty chalti rehti thi. Ab jaise hi batch ki koi copy
 * band hoti hai, baaki khuli copy walon ko bell jaata hai.
 *
 * Run (backend folder se):  node scripts/test-batch-nudge.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_batchnudge'; // throwaway DB
process.env.APP_LIVE_YMD = '2026-08-01';

import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Task } from '../src/models/Task.js';
import { Notification } from '../src/models/Notification.js';
import { loadRoles } from '../src/lib/roles.js';
import { setStatus, reviewTask } from '../src/services/task.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}

/** Kitne "yours is still open" bell is copy ke maalik ke paas pade hain. */
const nudges = (userId, taskId) =>
  Notification.find({ user: userId, type: 'TASK_BATCH_PENDING', ...(taskId ? { entityId: taskId } : {}) }).lean();

/** Ek batch banata hai: N logon ko wahi kaam, alag-alag copy. */
async function makeBatch(assigner, owners, extra = {}) {
  const batch = randomUUID();
  const out = [];
  for (const o of owners) {
    out.push(
      await Task.create({
        title: 'Shared job', owner: o._id, assignedBy: assigner._id,
        assignBatch: batch, status: 'PENDING', dueYMD: '2026-08-20', ...extra,
      }),
    );
  }
  return out;
}

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO & President', rank: 0, permissions: ['markAttendance'], isSystem: true },
    { key: 'MANAGER', label: 'Manager', rank: 20, permissions: ['markAttendance'], isSystem: true },
    { key: 'EMPLOYEE', label: 'Employee', rank: 50, permissions: ['markAttendance'], isSystem: true },
  ]);
  await loadRoles();
  await Setting.create({ key: 'global', companyName: 'TestCo', weekendDays: [0], bonus: { enabled: false } });
  Setting.invalidateCache();

  const mgr = await User.create({ name: 'Manager Ji', email: 'm@t.co', passwordHash: 'x', role: 'MANAGER', employeeId: 'T-M', isActive: true });
  const A = await User.create({ name: 'Ankur Saini', email: 'a@t.co', passwordHash: 'x', role: 'EMPLOYEE', employeeId: 'T-A', isActive: true });
  const B = await User.create({ name: 'Manish Kumar', email: 'b@t.co', passwordHash: 'x', role: 'EMPLOYEE', employeeId: 'T-B', isActive: true });
  const C = await User.create({ name: 'Chirag Verma', email: 'c@t.co', passwordHash: 'x', role: 'EMPLOYEE', employeeId: 'T-C', isActive: true });

  // ═══ TEST 1 — ek copy band hui → baaki khuli copy walon ko bell ═══
  console.log('TEST 1 — Ankur ne apni copy kar di: Manish + Chirag ko bell jaana chahiye');
  const [a1, b1, c1] = await makeBatch(mgr, [A, B, C]);
  await setStatus(A, a1._id, 'DONE');

  const nB = await nudges(B._id);
  const nC = await nudges(C._id);
  const nA = await nudges(A._id);
  check('Manish ko theek 1 bell', nB.length === 1, `got ${nB.length}`);
  check('Chirag ko theek 1 bell', nC.length === 1, `got ${nC.length}`);
  check('Ankur ko khud koi bell NAHI (usne to kar diya)', nA.length === 0, `got ${nA.length}`);
  check('bell me karne wale ka naam', (nB[0]?.title || '').startsWith('Ankur Saini finished'), nB[0]?.title);
  check('link Manish ki APNI copy pe (Ankur ki nahi)', nB[0]?.link === `/todo?task=${b1._id}`, nB[0]?.link);
  check('entityId bhi apni hi copy', String(nB[0]?.entityId) === String(b1._id));
  check('Chirag ka link bhi apni copy pe', nC[0]?.link === `/todo?task=${c1._id}`, nC[0]?.link);

  // ═══ TEST 2 — done ek toggle hai; dubara tick karne pe bell dobara na bhare ═══
  console.log('\nTEST 2 — Ankur ne undo karke phir DONE kiya: bell duplicate to nahi hua?');
  await setStatus(A, a1._id, 'PENDING');
  await setStatus(A, a1._id, 'DONE');
  check('Manish ke paas ab bhi sirf 1 bell', (await nudges(B._id)).length === 1, `got ${(await nudges(B._id)).length}`);
  check('Chirag ke paas ab bhi sirf 1 bell', (await nudges(C._id)).length === 1, `got ${(await nudges(C._id)).length}`);

  // ═══ TEST 3 — apni copy band karte hi apna wala bell hat jaana chahiye ═══
  console.log('\nTEST 3 — Manish ne bhi kar di: uska apna bell hatna chahiye, Chirag ka rehna chahiye');
  await setStatus(B, b1._id, 'DONE');
  check('Manish ka bell hat gaya', (await nudges(B._id)).length === 0, `got ${(await nudges(B._id)).length}`);
  check('Chirag ka bell abhi bhi 1 (double nahi hua)', (await nudges(C._id)).length === 1, `got ${(await nudges(C._id)).length}`);
  check('jo pehle hi DONE tha (Ankur) usko naya bell nahi mila', (await nudges(A._id)).length === 0);

  // ═══ TEST 4 — jo submit karke approval ka intezaar kar raha hai wo "baaki" nahi hai ═══
  console.log('\nTEST 4 — approval wala batch: submit kar chuke bande ko bell NAHI jaana chahiye');
  const [a2, b2, c2] = await makeBatch(mgr, [A, B, C], { requiresApproval: true });
  await setStatus(A, a2._id, 'DONE'); // requiresApproval → submit hota hai, DONE nahi
  const a2f = await Task.findById(a2._id);
  check('Ankur ki copy submitted hai (DONE nahi)', a2f.status === 'PENDING' && !!a2f.submittedAt, a2f.status);
  check('sirf submit karne se kisi ko bell nahi gaya', (await nudges(B._id, b2._id)).length === 0);

  // Manager ne Ankur ka kaam approve kiya → ab wo sach me DONE hai
  await reviewTask(mgr, a2._id, true);
  const nB2 = await nudges(B._id, b2._id);
  const nC2 = await nudges(C._id, c2._id);
  check('approve hote hi Manish ko bell', nB2.length === 1, `got ${nB2.length}`);
  check('Chirag ko bhi', nC2.length === 1, `got ${nC2.length}`);
  check('bell me KAAM KARNE WALE ka naam hai, approve karne wale ka nahi',
    (nB2[0]?.title || '').startsWith('Ankur Saini finished'), nB2[0]?.title);

  // ═══ TEST 5 — jiska kaam approval me atka hai use nudge mat karo ═══
  console.log('\nTEST 5 — Manish ne submit kar diya, phir Chirag ne kar diya: Manish ko taana na jaye');
  const [a3, b3, c3] = await makeBatch(mgr, [A, B, C], { requiresApproval: true });
  await setStatus(B, b3._id, 'DONE');       // Manish → submitted, approval ka intezaar
  await reviewTask(mgr, c3._id, false, 'x').catch(() => {}); // Chirag ne submit hi nahi kiya → error, ignore
  await setStatus(C, c3._id, 'DONE');       // Chirag → submitted
  await reviewTask(mgr, c3._id, true);      // Chirag approve → sach me DONE
  check('Manish (submitted, intezaar me) ko koi bell nahi', (await nudges(B._id, b3._id)).length === 0,
    `got ${(await nudges(B._id, b3._id)).length}`);
  check('Ankur (jiska kaam abhi khula hai) ko bell mila', (await nudges(A._id, a3._id)).length === 1,
    `got ${(await nudges(A._id, a3._id)).length}`);

  // ═══ TEST 6 — CONTROL: akele assign hua kaam ═══
  console.log('\nTEST 6 — CONTROL: sirf ek bande ko diya kaam → kisi ko kuch nahi');
  const before = await Notification.countDocuments({ type: 'TASK_BATCH_PENDING' });
  const solo = await Task.create({ title: 'Solo job', owner: A._id, assignedBy: mgr._id, status: 'PENDING', dueYMD: '2026-08-20' });
  await setStatus(A, solo._id, 'DONE');
  check('koi naya bell nahi bana', (await Notification.countDocuments({ type: 'TASK_BATCH_PENDING' })) === before);

  // ═══ TEST 7 — CONTROL: apna personal task (kisi ne diya hi nahi) ═══
  console.log('\nTEST 7 — CONTROL: apna personal task → crash bhi nahi, bell bhi nahi');
  const own = await Task.create({ title: 'Personal', owner: A._id, status: 'PENDING' });
  await setStatus(A, own._id, 'DONE');
  check('phir bhi koi naya bell nahi', (await Notification.countDocuments({ type: 'TASK_BATCH_PENDING' })) === before);

  // ═══ TEST 8 — CONTROL: doosre assigner ka batch chhua na jaye ═══
  console.log('\nTEST 8 — CONTROL: same batch id par doosra assigner → uski copy ko haath na lage');
  const batch = randomUUID();
  const mine = await Task.create({ title: 'X', owner: A._id, assignedBy: mgr._id, assignBatch: batch, status: 'PENDING', dueYMD: '2026-08-20' });
  const other = await Task.create({ title: 'X', owner: B._id, assignedBy: C._id, assignBatch: batch, status: 'PENDING', dueYMD: '2026-08-20' });
  await setStatus(A, mine._id, 'DONE');
  check('doosre assigner ki copy ko bell nahi gaya', (await nudges(B._id, other._id)).length === 0);

  console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PASS'}\n`);
  await mongoose.connection.dropDatabase();
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
