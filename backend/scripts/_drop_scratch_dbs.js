/**
 * Cluster0 par pade purane TEST/SCRATCH databases hataata hai — sirf neeche ki list wale,
 * naam se. Prod (office_management), demo (office_demo) aur MongoDB ke system DB (admin,
 * local) ko ye script chhoo bhi nahi sakti — wo yahan hard-block hain.
 *
 * Dekhne ke liye:  node scripts/_drop_scratch_dbs.js
 * Karne ke liye:   node scripts/_drop_scratch_dbs.js --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';

const APPLY = process.argv.includes('--apply');

// Jo hataane hain — bas ye 14.
const SCRATCH = [
  'a10_fix_test',
  'a11_v6_probe2',
  'a11_v6_probe3',
  'edges_test_scratch',
  'halfday_test_scratch',
  'l1l2_test_scratch',
  'office_test_deepchain_repro',
  'office_test_siblingbell',
  'office_test_twohopbell',
  'om_test_mail_1787220528220',
  'pdf_rates_scratch2',
  'rewards_verify_scratch',
  'test_cron_scratch',
  'test_whosout_scratch',
  // Chat ka kaam karte waqt bane (test scripts khud saaf karti hain; ye UI wala nahi karta)
  'office_ui_demo',
];
// Inko kabhi nahi — chahe list me galti se aa bhi jaayen.
const NEVER = new Set(['office_management', 'office_demo', 'admin', 'local', 'config']);

await connectDB();
const admin = mongoose.connection.db.admin();
const existing = new Map((await admin.listDatabases()).databases.map((d) => [d.name, d.sizeOnDisk]));
const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;

const todo = SCRATCH.filter((n) => !NEVER.has(n) && existing.has(n));
console.log(`\nMode: ${APPLY ? '⚠️  APPLY' : 'dry run'}\n`);
for (const n of SCRATCH) {
  if (NEVER.has(n)) console.log(`  ⛔ ${n} — protected, skip`);
  else if (!existing.has(n)) console.log(`  ·  ${n} — already gone`);
  else console.log(`  🗑️  ${n}  (${mb(existing.get(n))})`);
}
console.log(`\n  ${todo.length} database(s) hatenge. Bache rahenge: ${[...existing.keys()].filter((n) => !todo.includes(n)).join(', ')}`);

if (!APPLY) { console.log('\n(dry run — kuch nahi hata. Karne ke liye: --apply)\n'); await disconnectDB(); process.exit(0); }

for (const n of todo) {
  if (NEVER.has(n)) continue; // belt and braces
  // eslint-disable-next-line no-await-in-loop
  await mongoose.connection.useDb(n).dropDatabase();
  console.log(`  ✅ dropped ${n}`);
}
const after = (await admin.listDatabases()).databases.map((d) => `${d.name} (${mb(d.sizeOnDisk)})`);
console.log(`\nAb cluster par: ${after.join(', ')}\n`);
await disconnectDB();
