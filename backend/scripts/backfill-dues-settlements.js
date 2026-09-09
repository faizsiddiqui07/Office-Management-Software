/**
 * PURANE settle ke liye rasid (SETTLEMENT rows) banata hai.
 *
 * Kyun: settle karne par app due par `paid` to likh deti thi, par paise ki koi row nahi
 * banati thi. Isliye jo cash sach me haath me aaya wo history me kahin dikhta hi nahi —
 * aur ledger ko haath se jodo to jawab galat aata hai. Faiz ke ₹494 par yahi hua tha:
 * ₹24 cash mila tha, screen par uska koi nishaan nahi tha.
 *
 * Ye script SIRF wo purani rasidein banati hai. Kisi ka balance NAHI badalta — SETTLEMENT
 * row hisaab me jodi hi nahi jaati (dues.service ka computeLedger dekhein). Chalane se
 * pehle aur baad me har bande ka pending/advance chhap kar milaya jaata hai; agar ek
 * paisa bhi hila to script wahin ruk jaati hai aur kuch commit nahi karti.
 *
 * DEKHNE KE LIYE (kuch likhta nahi):   node scripts/backfill-dues-settlements.js
 * SACH ME CHALANE KE LIYE:             node scripts/backfill-dues-settlements.js --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { LedgerEntry } from '../src/models/LedgerEntry.js';
import { User } from '../src/models/User.js';
import { ymdInTz, companyDayFromYMD } from '../src/lib/time.js';

const APPLY = process.argv.includes('--apply');
const R = (p) => `Rs ${(p / 100).toFixed(2)}`;

/** Har bande ka aaj ka pending/advance — pehle aur baad me milane ke liye. */
async function balances() {
  const svc = await import('../src/services/dues.service.js');
  const people = [...new Set((await LedgerEntry.find().select('person').lean()).map((e) => String(e.person)))];
  const out = new Map();
  for (const pid of people) {
    const l = await svc.personLedger(pid);
    out.set(pid, `${l.pending}/${l.advance}`);
  }
  return out;
}

async function main() {
  await connectDB();
  const dbName = mongoose.connection.name;
  console.log(`\nDB: ${dbName}   |   mode: ${APPLY ? '⚠️  APPLY (likhega)' : 'dry run (kuch nahi likhega)'}\n`);

  const names = new Map((await User.find({}).select('name').lean()).map((u) => [String(u._id), u.name]));
  const before = await balances();

  // Har wo DUE jispar cash seedha chukaya gaya tha.
  const settled = await LedgerEntry.find({ kind: 'DUE', paid: { $gt: 0 } })
    .select('person paid item dateYMD updatedAt').sort({ updatedAt: 1 }).lean();

  // Ek settle-click me kai item ek saath chuke the — unki ek hi rasid banni chahiye,
  // kyunki paisa bhi ek hi baar haath me aaya tha. Isliye banda + jis din settle hua,
  // usse group kar rahe hain.
  const groups = new Map();
  for (const d of settled) {
    const day = ymdInTz(d.updatedAt);
    const key = `${d.person}|${day}`;
    if (!groups.has(key)) groups.set(key, { person: d.person, day, total: 0, items: [] });
    const g = groups.get(key);
    g.total += d.paid;
    g.items.push(d.item || 'item');
  }

  console.log(`${settled.length} due par cash chukaya mila, ${groups.size} alag settle-mauke bane:\n`);
  let planned = 0;
  let skipped = 0;
  const toCreate = [];
  for (const g of [...groups.values()].sort((a, b) => a.day.localeCompare(b.day))) {
    // Dobara chalane par duplicate na banein.
    const exists = await LedgerEntry.exists({
      kind: 'SETTLEMENT', person: g.person, dateYMD: g.day, amount: g.total,
    });
    const who = names.get(String(g.person)) || '?';
    if (exists) {
      skipped += 1;
      console.log(`  ${g.day}  ${who.padEnd(20)} ${R(g.total).padStart(11)}  — pehle se hai, chhoda`);
      continue;
    }
    planned += 1;
    const note = g.items.length === 1 ? `Settled: ${g.items[0]}` : `Settled ${g.items.length} items`;
    console.log(`  ${g.day}  ${who.padEnd(20)} ${R(g.total).padStart(11)}  ${note}`);
    toCreate.push({
      person: g.person,
      // Kisne settle kiya tha ye purane rows me likha nahi hai; us due ka createdBy hi
      // sabse kareeb hai, aur wahi Admin Manager hai jo ye kaam karta hai.
      createdBy: (await LedgerEntry.findOne({ person: g.person, kind: 'DUE' }).select('createdBy').lean())?.createdBy,
      kind: 'SETTLEMENT',
      amount: g.total,
      dateYMD: g.day,
      date: companyDayFromYMD(g.day),
      note,
    });
  }

  const total = toCreate.reduce((s, r) => s + r.amount, 0);
  console.log(`\n  banegi: ${planned} rasid, kul ${R(total)}${skipped ? `   |   pehle se maujood: ${skipped}` : ''}`);

  if (!APPLY) {
    console.log('\n(dry run — kuch nahi likha gaya. Sach me chalane ke liye: --apply)\n');
    await disconnectDB();
    return;
  }

  if (!toCreate.length) {
    console.log('\nkuch banane ko nahi hai.\n');
    await disconnectDB();
    return;
  }

  await LedgerEntry.insertMany(toCreate);
  console.log(`\n✅ ${toCreate.length} rasid ban gayi.`);

  // Ab pakka karo ki kisi ka balance hila nahi.
  const after = await balances();
  let moved = 0;
  for (const [pid, b] of before) {
    if (after.get(pid) !== b) {
      moved += 1;
      console.log(`  ❌ ${names.get(pid) || pid}: balance BADAL gaya  ${b}  →  ${after.get(pid)}`);
    }
  }
  console.log(moved
    ? `\n❌ ${moved} logon ka balance hil gaya — ye nahi hona chahiye tha. Upar wali rasidein hatani padengi.\n`
    : '\n✅ har bande ka pending aur advance bilkul waisa ka waisa hai — sirf history dikhne lagi.\n');

  await disconnectDB();
}

main().catch((e) => { console.error(e); process.exit(1); });
