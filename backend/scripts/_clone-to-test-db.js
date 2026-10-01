/**
 * Asli (prod) data ki ek COPY ek throwaway test DB me daalta hai — prod ko sirf PADHTA hai,
 * kuch likhta NAHI. Iska maqsad: koi bhi bada badlav (points rebuild waghairah) pehle copy
 * par chala kar natija dekh lo, prod ko haath lagaye bina.
 *
 *   node scripts/_clone-to-test-db.js --to office_test_rebuild
 *   node scripts/_clone-to-test-db.js --to office_test_rebuild --from office_management
 *
 * Target ke naam me "test" hona ZAROORI hai — warna script chalegi hi nahi. Prod aur demo
 * target ke taur par hard-block hain.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';

const flag = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const FROM = flag('from') || 'office_management';
const TO = flag('to');
const NEVER = new Set(['office_management', 'office_demo', 'office_ui_demo', 'admin', 'local', 'config']);

if (!TO) throw new Error('--to <dbname> chahiye');
if (!/test/i.test(TO)) throw new Error(`refusing: target "${TO}" ke naam me "test" nahi hai`);
if (NEVER.has(TO)) throw new Error(`refusing: "${TO}" protected hai`);

await connectDB();
const src = mongoose.connection.useDb(FROM);
const dst = mongoose.connection.useDb(TO);

await dst.dropDatabase();
console.log(`\n📋 ${FROM}  →  ${TO}   (target pehle khaali kiya)\n`);

const names = (await src.db.listCollections().toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.')).sort();
let total = 0;
for (const name of names) {
  // eslint-disable-next-line no-await-in-loop
  const docs = await src.collection(name).find({}).toArray();
  // eslint-disable-next-line no-await-in-loop
  if (docs.length) await dst.collection(name).insertMany(docs, { ordered: false });
  total += docs.length;
  console.log(`  ${String(docs.length).padStart(6)}  ${name}`);
}
console.log(`\n✅ ${total} documents, ${names.length} collections → ${TO}\n`);
await disconnectDB();
