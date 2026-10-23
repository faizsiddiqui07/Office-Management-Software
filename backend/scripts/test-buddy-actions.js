/**
 * Buddy se KAAM karwana — Phase 3 ki jaanch (plan: audits/15-ai-buddy-plan.md).
 *
 * Jo sabit karna hai:
 *   1. Poochhne bhar se KUCH NAHI hota — tajweez banti hai, record nahi
 *   2. Confirm par hi hota hai
 *   3. Ek "haan" par ek hi baar — dobara Confirm bekaar jaata hai
 *   4. Kisi AUR ki tajweez par Confirm nahi chalta
 *   5. Jo kaam v1 me nahi hai (kisi aur ko task dena) wo hota hi nahi
 *
 * Ispar PAISA lagta hai — har sawaal 1-2 asli API call.
 * Prod par chalne se INKAAR karta hai - DB ke naam me "test" hona zaroori hai.
 *
 *   node scripts/_clone-to-test-db.js --to office_test_act
 *   MONGODB_DB=office_test_act node scripts/test-buddy-actions.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Task } from '../src/models/Task.js';
import { LeaveRequest } from '../src/models/LeaveRequest.js';
import { AssistantAction } from '../src/models/AssistantAction.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { loadRoles } from '../src/lib/roles.js';
import { ask, confirm } from '../src/services/assistant/index.js';
import { claudeConfigured } from '../src/lib/claude.js';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${extra ? `  — ${extra}` : ''}`); }
};

if (!claudeConfigured()) { console.error('\nANTHROPIC_API_KEY nahi hai.\n'); process.exit(1); }
await connectDB();
const dbName = mongoose.connection.db.databaseName;
if (!/test/i.test(dbName)) { console.error(`\n✋ "${dbName}" test DB nahi lagta.\n`); process.exit(1); }
await loadRoles();
await AuditLog.deleteMany({ action: { $in: ['assistant.ask', 'assistant.confirm'] } });
console.log(`(DB: ${dbName})`);

const me = await User.findOne({ isActive: true, role: 'TEAM' });
const other = await User.findOne({ isActive: true, role: 'TEAM', _id: { $ne: me._id } })
  || await User.findOne({ isActive: true, _id: { $ne: me._id } });
console.log(`Main:   ${me.name} (${me.role})`);
console.log(`Doosra: ${other.name}\n`);

const TITLE = `UI-TEST buddy task ${Date.now()}`;
const countTasks = () => Task.countDocuments({ owner: me._id, title: TITLE });

// ── 1. Poochhne bhar se kuch na ho ──────────────────────────────────────────────
console.log('1) Sirf poochhne par KUCH NAHI hona chahiye');
let r1;
{
  const before = await countTasks();
  r1 = await ask(me, `ek to-do bana do: "${TITLE}"`);
  console.log(`   A: ${r1.answer}`);
  const after = await countTasks();
  ok(before === 0 && after === 0, 'task abhi BANA NAHI', `${after} mila`);
  ok(!!r1.pending, 'tajweez bani aur jawab ke saath aayi', JSON.stringify(r1.pending));
  ok(/confirm/i.test(r1.answer), 'jawab me confirm ki baat hai', r1.answer);
  ok(!/\b(created|ban gaya|bana diya|done)\b/i.test(r1.answer), 'jawab ne jhooth nahi bola ki ban gaya', r1.answer);
}

// ── 2. Doosre bande ka Confirm na chale ─────────────────────────────────────────
console.log('\n2) Kisi AUR ki tajweez par Confirm');
{
  let code = null;
  try { await confirm(other, r1.pending.id); } catch (e) { code = e.code; }
  ok(code === 'NOT_FOUND', 'doosre bande ko "nahi mila" mila (hona-na-hona bhi nahi bataya)', `code ${code}`);
  ok(await countTasks() === 0, 'us koshish se bhi kuch nahi bana');
}

// ── 3. Confirm par kaam ho ──────────────────────────────────────────────────────
console.log('\n3) Confirm par kaam');
{
  const done = await confirm(me, r1.pending.id);
  console.log(`   → ${done.summary}`);
  ok(await countTasks() === 1, 'ab task BAN gaya');
  const logged = await AuditLog.findOne({ action: 'assistant.confirm', entityId: String(r1.pending.id) });
  ok(!!logged, 'Activity log me gaya');
  ok(logged?.meta?.summary === done.summary, 'log me wahi line hai jo user ne dekhi thi');
}

// ── 4. Dobara Confirm bekaar ────────────────────────────────────────────────────
console.log('\n4) Dobara Confirm');
{
  let code = null;
  try { await confirm(me, r1.pending.id); } catch (e) { code = e.code; }
  ok(code === 'ALREADY_DONE', 'doosri baar ruk gaya', `code ${code}`);
  ok(await countTasks() === 1, 'duplicate task nahi bana');
}

// ── 5. Apna task done karna ─────────────────────────────────────────────────────
console.log('\n5) Apna to-do done karna');
{
  const r = await ask(me, `"${TITLE}" ko done mark kar do`);
  console.log(`   A: ${r.answer}`);
  ok(!!r.pending, 'tajweez bani');
  const stillPending = await Task.findOne({ owner: me._id, title: TITLE });
  ok(stillPending?.status === 'PENDING', 'Confirm se pehle abhi bhi PENDING');
  if (r.pending) {
    await confirm(me, r.pending.id);
    const t = await Task.findOne({ owner: me._id, title: TITLE });
    ok(t?.status === 'DONE', 'Confirm ke baad DONE', t?.status);
  }
}

// ── 6. Chhutti ki arzi ──────────────────────────────────────────────────────────
console.log('\n6) Chhutti ki arzi');
{
  const d = new Date(); d.setDate(d.getDate() + 20);
  const ymd = d.toISOString().slice(0, 10);
  const before = await LeaveRequest.countDocuments({ user: me._id, startYMD: ymd });
  const r = await ask(me, `${ymd} ko ek din ki casual leave lagani hai`);
  console.log(`   A: ${r.answer}`);
  ok(await LeaveRequest.countDocuments({ user: me._id, startYMD: ymd }) === before, 'arzi abhi LAGI NAHI');
  ok(!!r.pending, 'tajweez bani');
  if (r.pending) {
    await confirm(me, r.pending.id);
    const lv = await LeaveRequest.findOne({ user: me._id, startYMD: ymd });
    ok(!!lv, 'Confirm ke baad arzi lag gayi');
    ok(lv?.status === 'PENDING', 'arzi PENDING hai — approver ab bhi ek rok hai', lv?.status);
  }
}

// ── 7. Jo v1 me nahi hai ────────────────────────────────────────────────────────
console.log('\n7) Jo kaam v1 me NAHI hai');
{
  const before = await Task.countDocuments({ owner: other._id });
  const r = await ask(me, `${other.name} ko ek task do: report bhejni hai`);
  console.log(`   A: ${r.answer}`);
  ok(await Task.countDocuments({ owner: other._id }) === before, `${other.name} ko koi task NAHI mila`);
  ok(!r.pending || r.pending.kind === 'create_task', 'kisi aur ko dene wali tajweez bani hi nahi', JSON.stringify(r.pending));
}

// ── Safai ───────────────────────────────────────────────────────────────────────
await Task.deleteMany({ title: TITLE });
await AssistantAction.deleteMany({ user: me._id });

console.log(`\n${fail ? '❌' : '✅'} ${pass} paas, ${fail} fail\n`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
