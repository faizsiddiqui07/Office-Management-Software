/**
 * Purani "retired" announcements saaf karta hai — wo rows jo delete to ki ja chuki thi par
 * DB me padi reh gayi thi.
 *
 * Pehle delete sirf `isActive: false` karta tha, row kabhi hatti nahi thi. Ab delete sach
 * me delete hai (deleteAnnouncement), par jo rows us purane tareeke se "delete" hui thi wo
 * apne aap nahi hatengi — ye script unhi ke liye hai. Naye code ke baad aisi rows ban'ni
 * band ho jaati hain, isliye ye ek-baar ka kaam hai.
 *
 * Wahi cascade chalta hai jo app ka delete chalata hai: read-receipts, notifications, aur
 * WFH / emergency holiday ke pointer — sab saath jaate hain.
 *
 *   node scripts/purge-retired-announcements.js            # sirf dikhata hai, kuch nahi karta
 *   node scripts/purge-retired-announcements.js --apply    # sach me hata deta hai
 *   node scripts/purge-retired-announcements.js --db office_test_x
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const flag = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null; };
if (flag('db')) process.env.MONGODB_DB = flag('db');
const APPLY = process.argv.includes('--apply');

const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { Announcement } = await import('../src/models/Announcement.js');
const { AnnouncementRead } = await import('../src/models/AnnouncementRead.js');
const { Notification } = await import('../src/models/Notification.js');
const { deleteAnnouncement } = await import('../src/services/announcement.service.js');

await connectDB();
console.log(`\nDatabase: ${mongoose.connection.name}   |   Mode: ${APPLY ? '⚠️  APPLY' : 'dry run'}\n`);

const rows = await Announcement.find({ isActive: false }).select('title createdAt audienceRoles').sort({ createdAt: 1 });
const totalBefore = await Announcement.countDocuments({});
const liveBefore = await Announcement.countDocuments({ isActive: true });

if (!rows.length) {
  console.log('Koi retired announcement nahi mili — kuch saaf karne ko hai hi nahi.\n');
  await disconnectDB();
  process.exit(0);
}

console.log(`${rows.length} retired announcement milin:\n`);
for (const r of rows) {
  const reads = await AnnouncementRead.countDocuments({ announcement: r._id });
  const notifs = await Notification.countDocuments({ entityType: 'Announcement', entityId: r._id });
  console.log(`  🗑️  ${r.createdAt.toISOString().slice(0, 10)}  ${r.title}`);
  console.log(`      ${reads} read-receipt, ${notifs} notification saath jayengi`);
}
console.log(`\nAbhi: kul ${totalBefore} rows (${liveBefore} zinda, ${rows.length} retired)`);

if (!APPLY) {
  console.log('\n(dry run — kuch nahi hata. Karne ke liye: --apply)\n');
  await disconnectDB();
  process.exit(0);
}

console.log('\nHata raha hoon...\n');
let removed = 0;
let readsGone = 0;
for (const r of rows) {
  try {
    // eslint-disable-next-line no-await-in-loop
    const res = await deleteAnnouncement(String(r._id));
    removed += 1;
    readsGone += res.readsRemoved;
    console.log(`  ✅ hat gayi: ${res.title}  (${res.readsRemoved} read-receipt)`);
  } catch (e) {
    console.log(`  ❌ nahi hat payi: ${r.title} — ${e.message}`);
  }
}

const totalAfter = await Announcement.countDocuments({});
const liveAfter = await Announcement.countDocuments({ isActive: true });
const retiredAfter = await Announcement.countDocuments({ isActive: false });
console.log(`\nAb: kul ${totalAfter} rows (${liveAfter} zinda, ${retiredAfter} retired)`);
console.log(`${removed} announcement + ${readsGone} read-receipt hate.`);
console.log(liveAfter === liveBefore ? '✅ ek bhi ZINDA announcement nahi chhui gayi.\n' : `❌ RUKO — zinda announcements ${liveBefore} se ${liveAfter} ho gayi!\n`);

await disconnectDB();
