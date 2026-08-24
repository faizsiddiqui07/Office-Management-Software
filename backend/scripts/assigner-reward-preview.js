/**
 * READ-ONLY preview: naya "jo task assign kare usko +3" rule agar lagta hai to 1 Aug 2026
 * se ab tak ke complete ho chuke tasks pe kis-kis ko kitne points milenge.
 *
 * Ye script kuch bhi LIKHTA/BADALTA NAHI — sirf padhta hai aur ginta hai.
 *
 * Chalane ka tareeka (backend folder se):
 *   node scripts/assigner-reward-preview.js
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Task } from '../src/models/Task.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { loadRoles, ownerRoleKeys } from '../src/lib/roles.js';
import { companyDayFromYMD, ymdInTz } from '../src/lib/time.js';
import { ASSIGNER_FLOOR_YMD } from '../src/services/bonus.service.js';

const PTS = 3; // seeded value for assignTaskDone

async function main() {
  await connectDB();
  await loadRoles();

  const s = await Setting.getSingleton();
  const b = s.bonus || {};
  const configured = (b.autoRules || []).find((r) => r.key === 'assignTaskDone');
  const pts = configured ? Math.abs(Number(configured.points) || 0) : PTS;

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`  DB           : ${process.env.MONGODB_DB || 'office_management'}`);
  console.log(`  Company      : ${s.companyName || '(naam set nahi)'}   <-- asli office hona chahiye`);
  console.log(`  Bonus system : ${b.enabled ? 'ON' : 'OFF'}`);
  console.log(`  Rule se      : ${ASSIGNER_FLOOR_YMD}  |  har task pe: +${pts}`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  // Owner tier (CEO & President) — eligibility gate isi pe chalta hai.
  const ownerKeys = ownerRoleKeys();
  const ownerUsers = ownerKeys.length ? await User.find({ role: { $in: ownerKeys } }).select('_id name') : [];
  const ownerIds = new Set(ownerUsers.map((u) => String(u._id)));
  console.log(`  Owner tier (${ownerKeys.join(', ') || 'none'}): ${ownerUsers.map((u) => u.name).join(', ') || '—'}\n`);

  // Wahi filter jo backfill use karta hai: DONE + assigned + root copy + floor ke baad bana.
  const tasks = await Task.find({
    status: 'DONE',
    assignedBy: { $ne: null },
    forwardedFrom: null,
    createdAt: { $gte: companyDayFromYMD(ASSIGNER_FLOOR_YMD) },
  }).select('title owner assignedBy collaborators dueYMD status completedAt createdAt assignBatch')
    .sort({ completedAt: 1, _id: 1 }); // pehle-complete hua copy = batch ka anchor

  console.log(`  ${ASSIGNER_FLOOR_YMD} ke baad assign hue + complete ho chuke tasks: ${tasks.length}\n`);

  const users = await User.find({}).select('name role');
  const nameById = new Map(users.map((u) => [String(u._id), u.name]));

  const byAssigner = new Map(); // assignerId -> { count, points, skipped }
  let skippedNoDue = 0;
  let skippedUneligible = 0;
  let alreadyHave = 0;
  let skippedBatchDup = 0;
  const seenBatches = new Set(); // ek kaam = ek baar (multi-assign batch ka anchor hi ginte hain)

  for (const t of tasks) {
    // Gate 1: due date chahiye (no-due-date task points ke bahar hai)
    if (!t.dueYMD) { skippedNoDue += 1; continue; }
    // Gate 2: owner-tier visibility — CEO/President ne khud diya ho ya tagged ho
    const eligible = !ownerIds.size
      || ownerIds.has(String(t.assignedBy))
      || (t.collaborators || []).some((c) => ownerIds.has(String(c)));
    if (!eligible) { skippedUneligible += 1; continue; }
    // Gate 3: ek hi kaam kai logon ko diya (batch) → sirf ek baar ginti hai
    if (t.assignBatch) {
      const bk = `${t.assignBatch}|${t.assignedBy}`;
      if (seenBatches.has(bk)) { skippedBatchDup += 1; continue; }
      seenBatches.add(bk);
    }
    // Pehle se entry hai? (dobara chalane pe kuch add nahi hoga)
    // eslint-disable-next-line no-await-in-loop
    if (await PointEntry.findOne({ dedupeKey: `auto_assign:${t._id}` })) { alreadyHave += 1; continue; }

    const key = String(t.assignedBy);
    const row = byAssigner.get(key) || { count: 0, points: 0, tasks: [] };
    row.count += 1;
    row.points += pts;
    row.tasks.push({ title: t.title, done: t.completedAt ? ymdInTz(t.completedAt) : '?' });
    byAssigner.set(key, row);
  }

  const rows = [...byAssigner.entries()]
    .map(([id, r]) => ({ name: nameById.get(id) || '(deleted user)', ...r }))
    .sort((a, b2) => b2.points - a.points);

  if (!rows.length) {
    console.log('  Kisi ko bhi naye points NAHI milenge — koi eligible task nahi mila.\n');
  } else {
    console.log('  Kisko kitne NAYE points milenge:\n');
    console.log('  Naam                         | Tasks | Naye points');
    console.log('  ' + '-'.repeat(56));
    for (const r of rows) {
      console.log(`  ${r.name.padEnd(28)} | ${String(r.count).padStart(5)} | ${String('+' + r.points).padStart(11)}`);
    }
    const total = rows.reduce((sum, r) => sum + r.points, 0);
    console.log('  ' + '-'.repeat(56));
    console.log(`  ${'KUL'.padEnd(28)} | ${String(rows.reduce((n, r) => n + r.count, 0)).padStart(5)} | ${String('+' + total).padStart(11)}\n`);

    console.log('  Task-by-task:\n');
    for (const r of rows) {
      console.log(`  ${r.name}:`);
      for (const t of r.tasks) console.log(`     +${pts}  ${t.done}  ${t.title}`);
      console.log('');
    }
  }

  console.log('  Chhode gaye tasks (rule ke bahar):');
  console.log(`     ${skippedNoDue} \tdue date hi nahi thi`);
  console.log(`     ${skippedUneligible} \tCEO/President na assigner the na tagged`);
  console.log(`     ${skippedBatchDup} \tek hi kaam kai logon ko diya tha (ek baar hi gina)`);
  console.log(`     ${alreadyHave} \tpehle se entry maujood hai\n`);
  console.log('  (Ye sirf PREVIEW hai — abhi kuch bhi save NAHI hua.)\n');

  await disconnectDB();
}

main().then(() => process.exit(0)).catch((err) => { console.error('Preview failed:', err); process.exit(1); });
