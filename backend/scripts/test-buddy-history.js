/**
 * Buddy ki baatcheet — save, encryption, paging aur privacy ki jaanch.
 * (Plan: audits/15-ai-buddy-plan.md, Phase 4)
 *
 * Jo sabit karna hai:
 *   1. Baat DB me SACH ME encrypted padi hai — kachchi collection khol kar dekho
 *   2. history() use kholti hai, sahi kram me, page-dar-page
 *   3. Apni hi baatein — doosre ki kabhi nahi
 *   4. Activity log me SAWAAL KA MATN hai hi nahi (owner ka faisla)
 *   5. AI ko pichhli baat yaad rehti hai
 *   6. 90 din ka TTL index sach me laga hai
 *
 * Zyadatar hissa bina kisi API call ke chalta hai; sirf #5 me do asli sawaal jaate hain.
 * Prod par chalne se INKAAR karta hai — DB ke naam me "test" hona zaroori hai.
 *
 *   node scripts/_clone-to-test-db.js --to office_test_hist
 *   MONGODB_DB=office_test_hist node scripts/test-buddy-history.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { AssistantMessage } from '../src/models/AssistantMessage.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { sealBytes } from '../src/lib/secretBox.js';
import { loadRoles } from '../src/lib/roles.js';
import { ask, history, HISTORY_PAGE } from '../src/services/assistant/index.js';
import { claudeConfigured } from '../src/lib/claude.js';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${extra ? `  — ${extra}` : ''}`); }
};

await connectDB();
const dbName = mongoose.connection.db.databaseName;
if (!/test/i.test(dbName)) { console.error(`\n✋ "${dbName}" test DB nahi lagta.\n`); process.exit(1); }
await loadRoles();
console.log(`(DB: ${dbName})`);

const me = await User.findOne({ isActive: true, role: 'TEAM' });
const other = await User.findOne({ isActive: true, _id: { $ne: me._id } });
await AssistantMessage.deleteMany({ user: { $in: [me._id, other._id] } });
await AuditLog.deleteMany({ action: 'assistant.ask' });
console.log(`Main: ${me.name} · Doosra: ${other.name}\n`);

// ── 1. Encryption — kachchi collection se ───────────────────────────────────────
console.log('1) DB me baat encrypted padi hai');
const SECRET = 'mere kitne leave bache hain -- SECRET-MARKER-42';
{
  await AssistantMessage.create({ user: me._id, role: 'user', body: sealBytes(SECRET) });
  // Mongoose ko bypass karke — jaisa koi DB dump kholne wala dekhega.
  const raw = await mongoose.connection.db.collection('assistantmessages').findOne({ user: me._id });
  const asText = raw.body?.buffer ? Buffer.from(raw.body.buffer).toString('utf8') : String(raw.body);
  ok(!asText.includes('SECRET-MARKER-42'), 'kachchi row me matn padha NAHI ja sakta');
  ok(!asText.includes('leave'), 'koi shabd bhi saaf nahi dikhta');
  const back = await history(me, { limit: 5 });
  ok(back.turns.at(-1)?.text === SECRET, 'par history() use poora khol deti hai');
}

// ── 1b. Ek hi waqt par do baatein — YAHI bug ki jad thi ─────────────────────────
// Sawaal aur jawab ek saath insert hote hain, to `createdAt` ek hi millisecond ka ban
// sakta hai. Us haalat me sirf waqt se sort karne par kram tay NAHI hota — aur screen
// par jawab sawaal se PEHLE aa jaata tha. Tiebreaker ObjectId hai.
console.log('\n1b) Ek hi millisecond par sawaal aur jawab');
{
  await AssistantMessage.deleteMany({ user: me._id });
  const same = new Date();
  await AssistantMessage.insertMany([
    { user: me._id, role: 'user', body: sealBytes('SAWAAL-EK'), createdAt: same },
    { user: me._id, role: 'buddy', body: sealBytes('JAWAB-EK'), createdAt: same },
  ]);
  const h = await history(me, { limit: 10 });
  ok(h.turns[0]?.text === 'SAWAAL-EK', 'sawaal PEHLE aaya', h.turns.map((t) => t.text).join(' | '));
  ok(h.turns[1]?.text === 'JAWAB-EK', 'jawab uske BAAD');
  ok(h.turns[0]?.role === 'user' && h.turns[1]?.role === 'buddy', 'role bhi sahi kram me');
}

// ── 2. Paging ───────────────────────────────────────────────────────────────────
console.log('\n2) Page-dar-page (upar scroll wala raasta)');
{
  await AssistantMessage.deleteMany({ user: me._id });
  // 50 baatein, purani se nayi — har ek ka waqt alag, warna kram tay nahi hota.
  const base = Date.now() - 50 * 60000;
  for (let i = 0; i < 50; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await AssistantMessage.collection.insertOne({
      user: me._id, role: i % 2 ? 'buddy' : 'user',
      body: sealBytes(`baat #${i}`), createdAt: new Date(base + i * 60000),
    });
  }
  const p1 = await history(me);
  ok(p1.turns.length === HISTORY_PAGE, `pehle page par ${HISTORY_PAGE} baatein`, `${p1.turns.length} mili`);
  ok(p1.turns.at(-1).text === 'baat #49', 'sabse neeche SABSE NAYI baat');
  ok(p1.turns[0].text === 'baat #30', 'sabse upar us page ki sabse purani');
  ok(p1.hasMore === true, 'aur bhi hain');

  const p2 = await history(me, { before: p1.oldest });
  ok(p2.turns.at(-1).text === 'baat #29', 'doosra page theek wahan se juda jahan pehla khatam hua');
  ok(p2.turns.every((t) => !p1.turns.some((x) => x.text === t.text)), 'koi baat do baar nahi aayi');

  const p3 = await history(me, { before: p2.oldest });
  ok(p3.hasMore === false, 'teesre page par "bas, aur nahi"');
  ok(p3.turns[0].text === 'baat #0', 'sabse purani baat tak pahunch gaye');
}

// ── 3. Sirf apni ────────────────────────────────────────────────────────────────
console.log('\n3) Doosre ki baatein');
{
  await AssistantMessage.create({ user: other._id, role: 'user', body: sealBytes('DOOSRE-KI-BAAT') });
  const mine = await history(me, { limit: 50 });
  ok(!mine.turns.some((t) => t.text.includes('DOOSRE-KI-BAAT')), 'doosre ki baat meri history me nahi aayi');
  const theirs = await history(other, { limit: 50 });
  ok(theirs.turns.length === 1, 'unki apni unhe dikhti hai');
}

// ── 4. TTL ──────────────────────────────────────────────────────────────────────
console.log('\n4) 90 din ka TTL');
{
  const idx = await mongoose.connection.db.collection('assistantmessages').indexes();
  const ttl = idx.find((i) => i.expireAfterSeconds != null);
  ok(!!ttl, 'TTL index laga hai');
  ok(ttl?.expireAfterSeconds === 90 * 24 * 60 * 60, 'theek 90 din ka', `${ttl?.expireAfterSeconds}s`);
}

// ── 5. Asli sawaal — yaad aur privacy ───────────────────────────────────────────
if (!claudeConfigured()) {
  console.log('\n5) (ANTHROPIC_API_KEY nahi — asli sawaal wala hissa chhoda)');
} else {
  console.log('\n5) Asli sawaal: yaad rehti hai, aur log me matn nahi jaata');
  await AssistantMessage.deleteMany({ user: me._id });
  await AuditLog.deleteMany({ action: 'assistant.ask' });

  const r1 = await ask(me, 'mere kitne leave bache hain?');
  console.log(`   Q1: mere kitne leave bache hain?\n   A1: ${r1.answer}`);
  const r2 = await ask(me, 'aur WFH?');
  console.log(`   Q2: aur WFH?\n   A2: ${r2.answer}`);

  ok(/wfh|work from home|ghar/i.test(r2.answer), 'adhoore sawaal "aur WFH?" ka matlab samajh gaya', r2.answer);
  const saved = await history(me, { limit: 10 });
  ok(saved.turns.length === 4, 'dono sawaal aur dono jawab save hue', `${saved.turns.length} mile`);
  // Ginti kaafi nahi thi — pehle isi wajah se ulta kram pakda nahi gaya.
  ok(
    saved.turns.map((t) => t.role).join(',') === 'user,buddy,user,buddy',
    'kram theek: sawaal, jawab, sawaal, jawab',
    saved.turns.map((t) => t.role).join(','),
  );
  ok(saved.turns[0].text === 'mere kitne leave bache hain?', 'pehli line pehla SAWAAL hai', saved.turns[0].text.slice(0, 40));
  ok(saved.turns[2].text === 'aur WFH?', 'teesri line doosra sawaal hai', saved.turns[2].text.slice(0, 40));
  ok(!saved.turns[3].text.includes(saved.turns[1].text), 'doosre jawab me pehla jawab dobara nahi chipka', saved.turns[3].text.slice(0, 80));

  const logs = await AuditLog.find({ action: 'assistant.ask' });
  ok(logs.length === 2, 'dono sawaal log me ginti ke liye darj hue');
  // Sirf "leave" dhoondhna galat tha: wo tool ke NAAM (my_leave_balance) me bhi hai,
  // aur tool ka naam log karna to maqsad hi hai. Asli sawaal ka matn dhoondho.
  const asked = ['mere kitne leave bache hain?', 'aur WFH?'];
  const blob = JSON.stringify(logs.map((l) => l.meta || {}));
  ok(asked.every((t) => !blob.includes(t)), 'log me SAWAAL KA MATN kahin nahi hai', blob.slice(0, 120));
  ok(logs.every((l) => l.meta?.q === undefined), 'purana meta.q ab hai hi nahi');
  ok(logs.every((l) => Array.isArray(l.meta?.tools)), 'tool aur ginti phir bhi darj hai');
}

await AssistantMessage.deleteMany({ user: { $in: [me._id, other._id] } });
await AuditLog.deleteMany({ action: 'assistant.ask' });

console.log(`\n${fail ? '❌' : '✅'} ${pass} paas, ${fail} fail\n`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
