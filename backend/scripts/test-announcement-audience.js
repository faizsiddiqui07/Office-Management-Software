/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * Announcement me audience chunne ka imtihaan. Ye wahi bug hai jo 3 Oct 2026 ko pakda gaya:
 * validator har chune hue role ko ek HARDCODED list se milata tha (`ROLES`, jisme shuruaati
 * 7 default role the), jabki asli roles DB me hain aur baad me badal chuke the. Natija:
 * "Everyone" chalta tha (list khaali, jaanchne ko kuch nahi) par koi bhi audience chunne par
 * "Invalid request" aata tha. Prod me 9 me se 8 role us list me the hi nahi.
 *
 * Yahan jaancha jaata hai:
 *   1. DB ka HAR role audience ke taur par chalta hai (yahi tootta tha)
 *   2. Everyone (khaali list) bhi chalta hai
 *   3. Jo role maujood hi nahi, uspar SAAF error aata hai — "Invalid request" nahi
 *   4. Purani announcement me audience daalna (edit) bhi chalta hai
 *   5. Audience ASLI me kaam karta hai — sirf un logon ko dikhta hai, baakiyon ko nahi
 *
 * Asli data ki copy par:
 *   node scripts/_clone-to-test-db.js --to office_test_announce
 *   node scripts/test-announcement-audience.js
 */
import 'dotenv/config';

process.env.MONGODB_DB = process.env.MONGODB_DB_TEST || 'office_test_announce';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Announcement } from '../src/models/Announcement.js';
import { loadRoles } from '../src/lib/roles.js';
import { createAnnouncementSchema, updateAnnouncementSchema } from '../src/validators/announcements.validators.js';
import { createAnnouncement, updateAnnouncement, listVisible } from '../src/services/announcement.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? `  →  ${extra}` : ''}`);
  if (!cond) failures += 1;
}

/** Jo raasta asli request leti hai: pehle validator, phir service. */
async function post(creator, body) {
  const parsed = createAnnouncementSchema.safeParse(body);
  if (!parsed.success) {
    const e = new Error(parsed.error.issues.map((i) => i.message).join(', '));
    e.stage = 'validator';
    throw e;
  }
  try {
    return await createAnnouncement(creator, parsed.data);
  } catch (err) {
    err.stage = 'service';
    throw err;
  }
}

async function main() {
  await connectDB();
  if (!/test/i.test(mongoose.connection.name)) throw new Error(`refusing: "${mongoose.connection.name}" me "test" nahi hai`);
  await loadRoles();
  console.log(`\n🧪 Isolated DB: ${mongoose.connection.name}\n`);

  const owner = await User.findOne({ role: 'CEO_PRESIDENT', isActive: true }).select('name role');
  if (!owner) throw new Error('is DB me koi CEO_PRESIDENT nahi');
  const roles = await Role.find({}).select('key label').sort({ rank: 1 });
  console.log(`DB me ${roles.length} role hain. Har ek ko audience bana kar dekhte hain:\n`);

  // ── 1. Har asli role audience ban sakta hai ────────────────────────────────
  console.log('1) Har role audience ke taur par');
  for (const r of roles) {
    let err = null;
    try {
      await post(owner, { title: `Test — ${r.key}`, body: 'x', priority: 'NORMAL', audienceRoles: [r.key] });
    } catch (e) { err = e; }
    check(`${r.label}`, err === null, err ? `${err.stage}: ${err.message}` : '');
  }

  // ── 2. Everyone, aur ek se zyada role ─────────────────────────────────────
  console.log('\n2) Everyone aur multi-select');
  let e1 = null;
  try { await post(owner, { title: 'Everyone', body: 'x', audienceRoles: [] }); } catch (e) { e1 = e; }
  check('Everyone (khaali list)', e1 === null, e1 ? e1.message : '');

  const two = roles.slice(0, 2).map((r) => r.key);
  let e2 = null;
  try { await post(owner, { title: 'Do role', body: 'x', audienceRoles: two }); } catch (e) { e2 = e; }
  check(`do role saath me (${two.join(' + ')})`, e2 === null, e2 ? e2.message : '');

  // ── 3. Jo role hai hi nahi — saaf error aana chahiye ──────────────────────
  console.log('\n3) Jo role maujood nahi');
  let e3 = null;
  try { await post(owner, { title: 'Bad', body: 'x', audienceRoles: ['KOI_AISA_ROLE_NAHI'] }); } catch (e) { e3 = e; }
  check('mana kiya gaya', !!e3, e3 ? `${e3.stage}: ${e3.message}` : 'mana hi nahi kiya');
  check('error saaf hai, "Invalid request" nahi', !!e3 && /no longer exist/i.test(e3.message), e3 ? e3.message : '');
  check('purane 7 default role bhi ab reject hote hain (wo DB me hain hi nahi)', await (async () => {
    try { await post(owner, { title: 'Old', body: 'x', audienceRoles: ['EMPLOYEE'] }); return false; } catch { return true; }
  })());

  // ── 4. Edit se audience daalna ────────────────────────────────────────────
  console.log('\n4) Purani announcement me audience daalna (edit)');
  const plain = await post(owner, { title: 'Pehle everyone', body: 'x', audienceRoles: [] });
  const target = roles[0].key;
  const parsed = updateAnnouncementSchema.safeParse({ audienceRoles: [target] });
  check('validator edit ko paas karta hai', parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues));
  let e4 = null;
  let edited = null;
  if (parsed.success) {
    try { edited = await updateAnnouncement(plain.id, parsed.data); } catch (e) { e4 = e; }
  }
  check('edit chal gaya', e4 === null, e4 ? e4.message : '');
  check('audience sach me save hui', !!edited && JSON.stringify(edited.audienceRoles) === JSON.stringify([target]), edited ? JSON.stringify(edited.audienceRoles) : '');

  // ── 5. Audience ASLI me kaam karti hai ya nahi ────────────────────────────
  console.log('\n5) Audience sach me filter karti hai');
  const roleA = roles.find((r) => r.key !== owner.role) || roles[0];
  const made = await post(owner, { title: `SIRF ${roleA.label} ke liye`, body: 'x', audienceRoles: [roleA.key] });
  const inA = await User.findOne({ role: roleA.key, isActive: true }).select('name role');
  const outA = await User.findOne({ role: { $ne: roleA.key }, isActive: true }).select('name role');

  const sees = async (u) => {
    const rows = await listVisible(u);
    return rows.some((a) => String(a.id || a._id) === String(made.id));
  };
  if (inA) check(`${inA.name} (${roleA.label}) ko dikhti hai`, await sees(inA));
  else console.log(`  ·  ${roleA.label} me koi active user nahi — skip`);
  if (outA) check(`${outA.name} (${outA.role}) ko NAHI dikhti`, !(await sees(outA)));
  else console.log('  ·  doosre role ka koi user nahi — skip');

  // safai — test ki banayi hui rows hata do
  await Announcement.deleteMany({ title: /^(Test — |Everyone$|Do role$|Bad$|Old$|Pehle everyone$|SIRF )/ });

  console.log(`\n${failures ? `❌ ${failures} check fail` : '✅ saare check pass'}\n`);
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('\n💥', e); process.exit(1); });
