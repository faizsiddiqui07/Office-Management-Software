/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * Settle karne par ab ek RASID (SETTLEMENT row) banti hai, taaki history me dikhe ki
 * paisa kab aaya. Pehle nahi banti thi — isi wajah se Faiz ka ledger jod kar dekhne par
 * ₹470 aata tha jabki sahi ₹494 tha: ₹24 cash mila tha par kahin dikhta nahi tha.
 *
 * Is test ka SABSE ZAROORI kaam: pakka karna ki ye nayi row kisi hisaab me na jude.
 * Agar SETTLEMENT galti se payment-pool me ginti chali gayi to har bande ka advance
 * utna hi zyada dikhne lagega — yaani ek hi paisa do baar.
 *
 * Run (backend folder se):  node scripts/test-dues-settlement.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_duessettle'; // throwaway DB

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { LedgerEntry } from '../src/models/LedgerEntry.js';
import { loadRoles } from '../src/lib/roles.js';
import * as dues from '../src/services/dues.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}
const R = (p) => `Rs ${(p / 100).toFixed(2)}`;
const rupees = (r) => Math.round(r * 100);

let admin, person;

async function fresh() {
  await LedgerEntry.deleteMany({});
  person = await User.create({
    name: `Test Person ${Math.random().toString(36).slice(2, 8)}`,
    email: `p${Date.now()}${Math.random().toString(36).slice(2, 6)}@t.co`,
    passwordHash: 'x', role: 'TEAM', employeeId: `T-${Math.random().toString(36).slice(2, 8)}`, isActive: true,
  });
}
const addDue = (amt, ymd, item) => dues.createDue(admin, { person: person._id, amount: rupees(amt), item, dateYMD: ymd });
const addPay = (amt, ymd) => dues.createPayment(admin, { person: person._id, amount: rupees(amt), dateYMD: ymd, note: 'Advance' });
const state = async () => {
  const l = await dues.personLedger(String(person._id));
  return { pending: l.pending, advance: l.advance, entries: l.entries };
};

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([{ key: 'TEAM', label: 'Team', rank: 40, permissions: [], isSystem: true }]);
  await loadRoles();
  await Setting.create({ key: 'global', companyName: 'TestCo', weekendDays: [0] });
  Setting.invalidateCache();
  admin = await User.create({ name: 'Ankit Kumar', email: 'a@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'T-A', isActive: true });

  // ═══ TEST 1 — Faiz wala asli scenario, hu-ba-hu ═══
  console.log('TEST 1 — Faiz ka asli hisaab dobara banakar: jawab ₹494 hi aana chahiye');
  await fresh();
  {
    await addPay(1000, '2026-07-11');
    for (const [amt, ymd] of [[80, '2026-07-13'], [40, '2026-07-14'], [70, '2026-07-15'], [340, '2026-07-17'],
      [70, '2026-07-18'], [95, '2026-07-20'], [40, '2026-07-21'], [70, '2026-07-22'], [53, '2026-07-24'],
      [60, '2026-07-31'], [53, '2026-08-04'], [53, '2026-08-08']]) await addDue(amt, ymd, 'Khana');

    const before = await state();
    check('settle se pehle bakaya ₹24', before.pending === rupees(24), R(before.pending));

    await dues.settle(admin, String(person._id)); // "Settle all" — ₹24 cash aaya
    await addPay(1000, '2026-08-08');             // ek minute baad ₹1000 advance

    for (const [amt, ymd] of [[40, '2026-08-12'], [53, '2026-08-17'], [160, '2026-08-18'], [40, '2026-08-18'],
      [40, '2026-08-19'], [40, '2026-08-24'], [53, '2026-09-04'], [40, '2026-09-07'], [40, '2026-09-08']])
      await addDue(amt, ymd, 'Khana');

    const now = await state();
    check('advance ₹494 (website jaisa hi)', now.advance === rupees(494), R(now.advance));
    check('bakaya sifar', now.pending === 0, R(now.pending));
    const receipt = now.entries.find((e) => e.kind === 'SETTLEMENT');
    check('₹24 ki RASID history me dikh rahi hai', !!receipt && receipt.amount === rupees(24), receipt ? R(receipt.amount) : 'koi rasid nahi');
    // Ab ledger haath se joda ja sakta hai: 2000 aaya + 24 settle = 1530 dues + 494 bacha
    const paid = now.entries.filter((e) => e.kind === 'PAYMENT').reduce((s, e) => s + e.amount, 0);
    const settled = now.entries.filter((e) => e.kind === 'SETTLEMENT').reduce((s, e) => s + e.amount, 0);
    const duesTot = now.entries.filter((e) => e.kind === 'DUE').reduce((s, e) => s + e.amount, 0);
    check('haath se jod milta hai: aaya = gaya + bacha', paid + settled === duesTot + now.advance,
      `${R(paid)} + ${R(settled)}  vs  ${R(duesTot)} + ${R(now.advance)}`);
  }

  // ═══ TEST 2 — SABSE ZAROORI: rasid pool me na jude ═══
  console.log('\nTEST 2 — rasid banne se kisi ka advance ek paisa na badhe');
  await fresh();
  {
    await addDue(100, '2026-09-01', 'Lunch');
    const beforeAdv = (await state()).advance;
    await dues.settle(admin, String(person._id)); // ₹100 cash
    const after = await state();
    check('advance pehle bhi 0, ab bhi 0', beforeAdv === 0 && after.advance === 0, `${R(beforeAdv)} → ${R(after.advance)}`);
    check('bakaya bhi 0', after.pending === 0, R(after.pending));
    check('rasid maujood hai', after.entries.some((e) => e.kind === 'SETTLEMENT' && e.amount === rupees(100)));
  }

  // ═══ TEST 3 — ek item settle karne par uski apni rasid ═══
  console.log('\nTEST 3 — sirf ek item settle karna');
  await fresh();
  {
    const a = await addDue(60, '2026-09-01', 'Biryani');
    await addDue(40, '2026-09-02', 'Chai');
    await dues.settleDue(admin, a.entry.id);
    const st = await state();
    check('bakaya sirf doosre item ka ₹40', st.pending === rupees(40), R(st.pending));
    const rec = st.entries.find((e) => e.kind === 'SETTLEMENT');
    check('rasid ₹60 ki bani', rec?.amount === rupees(60), rec ? R(rec.amount) : 'nahi bani');
    check('rasid par item ka naam', /Biryani/.test(rec?.note || ''), rec?.note);
    check('rasid us due se judi hai', String(rec?.settles) === String(a.entry.id), String(rec?.settles));
    check('advance nahi bana', st.advance === 0, R(st.advance));
  }

  // ═══ TEST 4 — advance pehle se ho to settle kuch na kare (na rasid) ═══
  console.log('\nTEST 4 — advance se hi cover ho raha ho to settle par kuch na ho');
  await fresh();
  {
    await addPay(500, '2026-09-01');
    await addDue(100, '2026-09-02', 'Lunch');
    const r = await dues.settle(admin, String(person._id));
    const st = await state();
    check('settle ne mana kiya (kuch bakaya hi nahi)', r.settled === false, JSON.stringify(r));
    check('koi jhoothi rasid nahi bani', !st.entries.some((e) => e.kind === 'SETTLEMENT'));
    check('advance waisa ka waisa ₹400', st.advance === rupees(400), R(st.advance));
  }

  // ═══ TEST 5 — rasid na badli ja sake, na mitayi ja sake ═══
  console.log('\nTEST 5 — rasid ko chheda na ja sake');
  await fresh();
  {
    await addDue(100, '2026-09-01', 'Lunch');
    await dues.settle(admin, String(person._id));
    const rec = (await state()).entries.find((e) => e.kind === 'SETTLEMENT');
    let err = null;
    try { await dues.updateEntry(admin, rec.id, { amount: rupees(500) }); } catch (e) { err = e.code; }
    check('edit par saaf mana', err === 'SETTLEMENT_LOCKED', String(err));
    err = null;
    try { await dues.deleteEntry(rec.id); } catch (e) { err = e.code; }
    check('delete par bhi mana', err === 'SETTLEMENT_LOCKED', String(err));
    check('rasid abhi bhi maujood', (await state()).entries.some((e) => e.kind === 'SETTLEMENT'));
    check('balance hila bhi nahi', (await state()).pending === 0);
  }

  // ═══ TEST 6 — roster aur CSV bhi wahi kahein ═══
  console.log('\nTEST 6 — roster aur CSV export bhi wahi hisaab dein');
  await fresh();
  {
    await addPay(1000, '2026-09-01');
    await addDue(300, '2026-09-02', 'Parts');
    await addDue(200, '2026-09-03', 'Lunch');
    const ov = await dues.overview();
    const row = ov.people.find((p) => String(p.person.id) === String(person._id));
    check('roster par advance ₹500', row?.advance === rupees(500), R(row?.advance || 0));
    // CSV ke liye ek aisa banda chahiye jiska advance na ho — warna settle karne ko
    // kuch bacha hi nahi hota (TEST 4 wahi saabit karta hai).
    await fresh();
    const d = await addDue(300, '2026-09-02', 'Parts');
    await dues.settleDue(admin, d.entry.id);
    const csv2 = await dues.exportRows();
    const set = csv2.rows.find((r) => r[3] === 'Settlement');
    check('settle ke baad CSV me Settlement row aayi', !!set, csv2.rows.map((r) => r[3]).join(','));
    check('uska status "Settled"', set?.[7] === 'Settled', set?.[7]);
    check('uska amount 300.00', set?.[6] === '300.00', set?.[6]);
  }

  console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PASS'}\n`);
  await mongoose.connection.dropDatabase();
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
