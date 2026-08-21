/**
 * Fill the DEMO database with a full sample office. Run from the backend folder:
 *
 *   MONGODB_DB=office_demo node scripts/seed-demo.js
 *
 * SAFETY: refuses to run unless MONGODB_DB clearly names a demo database — this DROPS the
 * database first, so it must never touch the real `office_management` data.
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { seedDemo, DEMO_PASSWORD, DEMO_USERS } from '../src/demo/seedDemo.js';

const db = process.env.MONGODB_DB || '';
if (!/demo/i.test(db)) {
  console.error(`\n✋ Refusing to seed: MONGODB_DB is "${db || '(unset)'}".`);
  console.error('   This wipes the database. Run it only against a demo DB, e.g.:');
  console.error('   MONGODB_DB=office_demo node scripts/seed-demo.js\n');
  process.exit(1);
}

async function main() {
  await connectDB();
  console.log(`🌱 Seeding demo database "${db}" …`);
  const result = await seedDemo({ reset: true });
  console.log('\n✅ Demo seeded:', JSON.stringify(result));
  console.log('────────────────────────────────────────────────────────────');
  console.log(`  Password for EVERY demo login:  ${DEMO_PASSWORD}`);
  console.log('  One login per role:');
  const seen = new Set();
  for (const u of DEMO_USERS) {
    if (seen.has(u.role)) continue;
    seen.add(u.role);
    console.log(`    ${u.role.padEnd(14)} ${u.email}`);
  }
  console.log('────────────────────────────────────────────────────────────\n');
  await disconnectDB();
}

main().then(() => process.exit(0)).catch((err) => { console.error('Demo seed failed:', err); process.exit(1); });
