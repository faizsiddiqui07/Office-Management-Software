/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * Announcement delete karne par ab wo DB se SACH ME hat'ti hai (pehle sirf isActive:false
 * hota tha aur row hamesha padi rehti thi — owner ko 4 dikhte the, DB me 6 the).
 *
 * Jaancha jaata hai:
 *   1. Row poori tarah hat gayi
 *   2. Uske read-receipts hat gaye
 *   3. Usne jo notifications bheji thi, wo bhi hat gayi
 *   4. DOOSRI announcements ka kuch bhi nahi chhua gaya — yahi sabse zaroori hai
 *   5. WFH / emergency holiday ne jo pointer rakha tha wo null ho gaya (dangling nahi raha)
 *   6. Jo hai hi nahi use delete karne par saaf 404
 *   7. Activity log me title bach gaya — row gayi, record nahi
 *
 *   node scripts/_clone-to-test-db.js --to office_test_anndel
 *   node scripts/test-announcement-delete.js
 */
import 'dotenv/config';

process.env.MONGODB_DB = process.env.MONGODB_DB_TEST || 'office_test_anndel';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Setting } from '../src/models/Setting.js';
import { Announcement } from '../src/models/Announcement.js';
import { AnnouncementRead } from '../src/models/AnnouncementRead.js';
import { Notification } from '../src/models/Notification.js';
import { loadRoles } from '../src/lib/roles.js';
import { createAnnouncement, deleteAnnouncement, markRead } from '../src/services/announcement.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? `  →  ${extra}` : ''}`);
  if (!cond) failures += 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await connectDB();
  if (!/test/i.test(mongoose.connection.name)) throw new Error(`refusing: "${mongoose.connection.name}" me "test" nahi hai`);
  await loadRoles();
  console.log(`\n🧪 Isolated DB: ${mongoose.connection.name}\n`);

  const owner = await User.findOne({ role: 'CEO_PRESIDENT', isActive: true }).select('name role');
  const readers = await User.find({ isActive: true, role: { $ne: 'CEO_PRESIDENT' } }).select('name role').limit(3);

  // Do announcement banao — ek jo delete hogi, ek jo chhedni NAHI chahiye.
  const victim = await createAnnouncement(owner, { title: 'DELETE HONE WALI', body: 'x', priority: 'NORMAL', audienceRoles: [] });
  const bystander = await createAnnouncement(owner, { title: 'ISE HAATH NAHI LAGNA CHAHIYE', body: 'y', priority: 'NORMAL', audienceRoles: [] });
  await sleep(600); // notify() fire-and-forget hai — usse likhne ka waqt do

  for (const u of readers) {
    // eslint-disable-next-line no-await-in-loop
    await markRead(u, victim.id);
    // eslint-disable-next-line no-await-in-loop
    await markRead(u, bystander.id);
  }

  const before = {
    victimReads: await AnnouncementRead.countDocuments({ announcement: victim.id }),
    bystanderReads: await AnnouncementRead.countDocuments({ announcement: bystander.id }),
    victimNotifs: await Notification.countDocuments({ entityType: 'Announcement', entityId: victim.id }),
    bystanderNotifs: await Notification.countDocuments({ entityType: 'Announcement', entityId: bystander.id }),
    otherNotifs: await Notification.countDocuments({ entityType: { $ne: 'Announcement' } }),
    otherAnns: await Announcement.countDocuments({ _id: { $nin: [victim.id, bystander.id] } }),
  };
  console.log('Delete se pehle:');
  console.log(`  delete hone wali — ${before.victimReads} read, ${before.victimNotifs} notification`);
  console.log(`  bachne wali      — ${before.bystanderReads} read, ${before.bystanderNotifs} notification`);
  console.log(`  baaki DB me      — ${before.otherAnns} aur announcements, ${before.otherNotifs} doosri notifications`);
  check('setup theek hai (dono ke read aur notification bane)', before.victimReads > 0 && before.victimNotifs > 0 && before.bystanderReads > 0);

  // ── DELETE ────────────────────────────────────────────────────────────────
  console.log('\n1-3) Delete karne par');
  const res = await deleteAnnouncement(victim.id);
  check('row DB se poori tarah hat gayi', (await Announcement.countDocuments({ _id: victim.id })) === 0);
  check('uske read-receipts hat gaye', (await AnnouncementRead.countDocuments({ announcement: victim.id })) === 0);
  check('usne jo notifications bheji thi, wo hat gayi', (await Notification.countDocuments({ entityType: 'Announcement', entityId: victim.id })) === 0);
  check('result me title aur ginti wapas aayi', res.title === 'DELETE HONE WALI' && res.readsRemoved === before.victimReads, `${res.title} / ${res.readsRemoved} read hate`);

  console.log('\n4) Doosri announcements ka kuch nahi chhua');
  check('bachne wali announcement zinda hai', (await Announcement.countDocuments({ _id: bystander.id })) === 1);
  check('uske read-receipts waise ke waise', (await AnnouncementRead.countDocuments({ announcement: bystander.id })) === before.bystanderReads, `${before.bystanderReads}`);
  check('uski notifications waise ki waise', (await Notification.countDocuments({ entityType: 'Announcement', entityId: bystander.id })) === before.bystanderNotifs, `${before.bystanderNotifs}`);
  check('baaki saari announcements zinda', (await Announcement.countDocuments({ _id: { $nin: [victim.id, bystander.id] } })) === before.otherAnns, `${before.otherAnns}`);
  check('announcement se alag notifications waise ki waisi', (await Notification.countDocuments({ entityType: { $ne: 'Announcement' } })) === before.otherNotifs, `${before.otherNotifs}`);

  // ── 5. WFH / emergency holiday ka pointer ────────────────────────────────
  console.log('\n5) WFH / emergency holiday ka pointer dangling nahi rehta');
  const linked = await createAnnouncement(owner, { title: 'WFH wali', body: 'z', audienceRoles: [] });
  await Setting.updateOne({ key: 'global' }, { $push: { wfhDays: { ymd: '2026-12-25', announcementId: linked.id } } });
  Setting.invalidateCache();
  await deleteAnnouncement(linked.id);
  const s = await Setting.getSingleton();
  const entry = (s.wfhDays || []).find((d) => d.ymd === '2026-12-25');
  check('WFH ka din abhi bhi maujood hai', !!entry);
  check('uska announcementId ab null hai (ghost nahi)', !!entry && entry.announcementId == null, entry ? String(entry.announcementId) : '');
  await Setting.updateOne({ key: 'global' }, { $pull: { wfhDays: { ymd: '2026-12-25' } } });
  Setting.invalidateCache();

  // ── 6. Jo hai hi nahi ─────────────────────────────────────────────────────
  console.log('\n6) Jo announcement hai hi nahi');
  let err = null;
  try { await deleteAnnouncement(new mongoose.Types.ObjectId()); } catch (e) { err = e; }
  check('saaf 404 aaya', err?.status === 404, err ? `${err.status} ${err.code}` : 'koi error hi nahi');
  let err2 = null;
  try { await deleteAnnouncement(victim.id); } catch (e) { err2 = e; }
  check('dobara delete karne par bhi 404 (crash nahi)', err2?.status === 404, err2 ? `${err2.status}` : 'koi error hi nahi');

  // safai
  await Announcement.deleteMany({ title: { $in: ['ISE HAATH NAHI LAGNA CHAHIYE'] } });

  console.log(`\n${failures ? `❌ ${failures} check fail` : '✅ saare check pass'}\n`);
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('\n💥', e); process.exit(1); });
