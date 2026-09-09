/**
 * Purani settlement rows ka LIKHA HUA theek karta hai. Koi amount nahi chhuta.
 *
 * Kyun: rasid ka note "Settled: Roti + Dahi" tha, aur screen par wo ₹24 ke bilkul saath
 * title bankar aata tha — padhne me lagta tha ki Roti + Dahi hi ₹24 ka tha. Asal me wo
 * ₹53 ka tha aur ₹24 uska bacha hua hissa tha jo cash me chukaya gaya. Ab note
 * "towards Roti + Dahi" kehta hai, yaani paisa kis taraf gaya — na ki cheez ka daam.
 *
 * Sirf `note` field badalta hai. amount, paid, date, person, kind — kisi ko haath nahi.
 *
 * DEKHNE KE LIYE (kuch likhta nahi):  node scripts/fix-settlement-notes.js
 * SACH ME CHALANE KE LIYE:            node scripts/fix-settlement-notes.js --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { LedgerEntry } from '../src/models/LedgerEntry.js';

const APPLY = process.argv.includes('--apply');

/** "Settled: Roti + Dahi " → "towards Roti + Dahi" · "Settled 9 items" → "towards 9 items" */
function reword(note) {
  const n = String(note || '').trim();
  let m = /^Settled:\s*(.+)$/i.exec(n);
  if (m) return `towards ${m[1].trim()}`;
  m = /^Settled\s+(\d+)\s+items?$/i.exec(n);
  if (m) return `towards ${m[1]} items`;
  if (/^Settled everything outstanding$/i.test(n)) return 'towards everything outstanding';
  if (/^Settled one item$/i.test(n)) return 'towards one item';
  return null; // pehchana nahi — chhod do, andaza mat lagao
}

async function main() {
  await connectDB();
  console.log(`\nDB: ${mongoose.connection.name}   |   mode: ${APPLY ? '⚠️  APPLY' : 'dry run'}\n`);

  const rows = await LedgerEntry.find({ kind: 'SETTLEMENT' }).sort({ dateYMD: 1 }).lean();
  const plan = [];
  for (const r of rows) {
    const next = reword(r.note);
    if (!next || next === r.note) {
      console.log(`  ${r.dateYMD}  chhoda      "${r.note}"`);
      continue;
    }
    plan.push({ _id: r._id, note: next });
    console.log(`  ${r.dateYMD}  "${r.note}"  →  "${next}"`);
  }
  console.log(`\n  badlengi: ${plan.length} / ${rows.length} rows (sirf note)`);

  if (!APPLY) {
    console.log('\n(dry run — kuch nahi likha gaya. Chalane ke liye: --apply)\n');
    await disconnectDB();
    return;
  }
  if (!plan.length) { console.log('\nkuch badalne ko nahi.\n'); await disconnectDB(); return; }

  // Amount ka jod pehle aur baad me — pakka karne ke liye ki sirf likhawat badli.
  const sumOf = async () => (await LedgerEntry.aggregate([
    { $group: { _id: '$kind', s: { $sum: '$amount' }, p: { $sum: '$paid' }, n: { $sum: 1 } } },
  ])).sort((a, b) => String(a._id).localeCompare(String(b._id)));
  const before = JSON.stringify(await sumOf());

  for (const p of plan) await LedgerEntry.updateOne({ _id: p._id }, { $set: { note: p.note } });
  console.log(`\n✅ ${plan.length} note theek ho gaye.`);

  const after = JSON.stringify(await sumOf());
  console.log(before === after
    ? '✅ har kind ka amount, paid aur ginti bilkul waisi hi hai — sirf likhawat badli.\n'
    : `❌ AANKDE BADAL GAYE\n  pehle: ${before}\n  baad : ${after}\n`);

  await disconnectDB();
}

main().catch((e) => { console.error(e); process.exit(1); });
