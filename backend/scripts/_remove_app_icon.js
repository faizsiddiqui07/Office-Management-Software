/**
 * Settings se `appIcon` field hataana — ek baar ka kaam.
 *
 * Kyun: app icon ab ManagiBot (product) ka hai, code me (website/public/brand/). Settings
 * me is field ka koi matlab nahi bacha; schema se bhi hat gaya. Ye script DB me pade
 * purane value ko unset karti hai taaki koi purana code/reader use na utha le.
 *
 * S3 par padi file (branding/app-icon-<ts>.png) ye script NAHI hataati — local machine
 * par AWS credentials nahi hain. Wo S3 console se hataani hai; script uska exact naam
 * chhaap deti hai.
 *
 * Run:  node scripts/_remove_app_icon.js            (dry-run — kuch nahi badalta)
 *       node scripts/_remove_app_icon.js --apply    (DB me unset)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDB();
  const col = mongoose.connection.db.collection('settings');
  const doc = await col.findOne({ key: 'global' }, { projection: { appIcon: 1 } });
  const url = doc?.appIcon || '';
  console.log(`\nDB: ${mongoose.connection.name}`);
  if (!url) {
    console.log('appIcon: (pehle se khaali) — kuch karne ko nahi.\n');
    await disconnectDB();
    return;
  }
  console.log(`appIcon: ${url}`);
  const key = url.includes('.amazonaws.com/') ? url.split('.amazonaws.com/')[1].split('?')[0] : null;
  if (key) console.log(`\nS3 par ye object haath se hataana hai (S3 console → bucket → is key par → Delete):\n   ${key}`);

  if (!APPLY) {
    console.log('\n[dry-run] DB me kuch nahi badla. --apply se unset hoga.\n');
    await disconnectDB();
    return;
  }
  const res = await col.updateOne({ key: 'global' }, { $unset: { appIcon: 1 } });
  console.log(`\n✅ DB: appIcon unset (matched ${res.matchedCount}, modified ${res.modifiedCount})\n`);
  await disconnectDB();
}

main().catch(async (e) => { console.error(e); try { await disconnectDB(); } catch { /* */ } process.exit(1); });
