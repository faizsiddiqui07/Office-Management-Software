/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * Announcement ab alag-alag logon ko bheji ja sakti hai (role ke bajaye naam se). Ye test
 * theek un saat jagahon par haath rakhta hai jahan design review ne kaha tha ki ye feature
 * chup-chaap tootega:
 *
 *   1. Individual post SIRF chune hue logon ko dikhe
 *   2. PURANI post (jisme audienceUsers field hai hi nahi) ab bhi SABKO dikhe
 *      — `$size: 0` missing field ko match nahi karta; akela likha hota to saari purani
 *        announcements sabse chhup jatin, bina kisi error ke
 *   3. Bell sirf utne logon ko jaye, poore office ko nahi
 *      — `{_id:{$in:ids}}` ke saath `{_id:{$ne:author}}` spread karne par doosri key pehli
 *        ko kha jati hai aur 3 logon wali post sab ko chali jati hai
 *   4. Likhne wale ko apni post khud dikhe, chahe wo audience me na ho
 *      — warna Edit, Delete aur "Seen by" sab unreachable
 *   5. "Seen by X of Y" ka Y sirf chune hue log ho
 *   6. Sirf title badalne par audience NA mite; Team→Individual par purane roles mit jayen
 *   7. Scheduled / repeating post bhi sirf chune hue logon ko jaye
 *      — teen scheduler .select() me audienceUsers chhoot jaye to mongoose [] de deta hai
 *        aur code chup-chaap "everyone" par gir jata hai
 *
 *   node scripts/_clone-to-test-db.js --to office_test_indiv
 *   node scripts/test-announcement-individuals.js
 */
import 'dotenv/config';

process.env.MONGODB_DB = process.env.MONGODB_DB_TEST || 'office_test_indiv';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Announcement } from '../src/models/Announcement.js';
import { AnnouncementRead } from '../src/models/AnnouncementRead.js';
import { Notification } from '../src/models/Notification.js';
import { loadRoles } from '../src/lib/roles.js';
import { createAnnouncementSchema, updateAnnouncementSchema } from '../src/validators/announcements.validators.js';
import {
  createAnnouncement, updateAnnouncement, deleteAnnouncement, listVisible,
  readReceipts, markRead, publishDueAnnouncements, audiencePeople,
} from '../src/services/announcement.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? `  →  ${extra}` : ''}`);
  if (!cond) failures += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wahi raasta jo asli request leti hai: pehle validator, phir service. */
async function post(creator, body) {
  const parsed = createAnnouncementSchema.safeParse(body);
  if (!parsed.success) { const e = new Error(parsed.error.issues.map((i) => i.message).join(', ')); e.stage = 'validator'; throw e; }
  return createAnnouncement(creator, parsed.data);
}
async function put(id, body) {
  const parsed = updateAnnouncementSchema.safeParse(body);
  if (!parsed.success) { const e = new Error(parsed.error.issues.map((i) => i.message).join(', ')); e.stage = 'validator'; throw e; }
  return updateAnnouncement(id, parsed.data);
}
const sees = async (u, id) => (await listVisible(u)).some((a) => String(a.id) === String(id));

async function main() {
  await connectDB();
  if (!/test/i.test(mongoose.connection.name)) throw new Error(`refusing: "${mongoose.connection.name}" me "test" nahi hai`);
  await loadRoles();
  console.log(`\n🧪 Isolated DB: ${mongoose.connection.name}\n`);

  const owner = await User.findOne({ role: 'CEO_PRESIDENT', isActive: true }).select('name role');
  const all = await User.find({ isActive: true, _id: { $ne: owner._id } }).select('name role').sort({ name: 1 });
  const picked = all.slice(0, 3);
  const notPicked = all.slice(3);
  console.log(`Chune gaye: ${picked.map((u) => u.name).join(', ')}`);
  console.log(`Nahi chune (${notPicked.length}): ${notPicked.map((u) => u.name).join(', ')}\n`);

  // ── 1. Sirf chune hue logon ko dikhe ──────────────────────────────────────
  console.log('1) Individual post sirf chune hue logon ko dikhti hai');
  const ann = await post(owner, { title: 'Sirf teen logon ke liye', body: 'x', audienceUsers: picked.map((u) => String(u._id)) });
  await sleep(600); // notify() fire-and-forget hai
  for (const u of picked) check(`${u.name} ko dikhti hai`, await sees(u, ann.id));
  let wrongly = 0;
  for (const u of notPicked) if (await sees(u, ann.id)) { wrongly += 1; console.log(`     ❌ ${u.name} ko bhi dikh rahi hai`); }
  check(`baaki ${notPicked.length} logon ko NAHI dikhti`, wrongly === 0);

  // ── 2. Purani rows (bina audienceUsers field ke) ──────────────────────────
  console.log('\n2) Purani post jisme ye field hai hi nahi');
  const legacy = await post(owner, { title: 'Purani — sabke liye', body: 'y', audienceRoles: [] });
  // Mongo se field poori tarah hata do — bilkul waise jaise purani rows me hai hi nahi
  await Announcement.collection.updateOne({ _id: new mongoose.Types.ObjectId(legacy.id) }, { $unset: { audienceUsers: '' } });
  const raw = await Announcement.collection.findOne({ _id: new mongoose.Types.ObjectId(legacy.id) });
  check('field sach me gayab hai (asli purani row jaisi)', !('audienceUsers' in raw));
  let missed = 0;
  for (const u of all) if (!(await sees(u, legacy.id))) { missed += 1; console.log(`     ❌ ${u.name} ko nahi dikhi`); }
  check('phir bhi SAB ko dikhti hai', missed === 0, `${all.length} log jaanche`);

  // ── 3. Bell sirf chune hue logon ko ───────────────────────────────────────
  console.log('\n3) Bell sirf chune hue logon ko');
  const bells = await Notification.find({ entityType: 'Announcement', entityId: ann.id }).select('user').lean();
  const rang = new Set(bells.map((b) => String(b.user)));
  check(`theek ${picked.length} logon ko bell gayi`, rang.size === picked.length, `${rang.size} gayi`);
  check('likhne wale ko apni hi post ka bell nahi gaya', !rang.has(String(owner._id)));
  check('kisi na-chune bande ko bell nahi gayi', notPicked.every((u) => !rang.has(String(u._id))));

  // ── 4. Likhne wale ko apni post dikhe ─────────────────────────────────────
  console.log('\n4) Likhne wale ko apni post khud dikhti hai');
  check('owner ko apni individual post dikhti hai (Edit/Delete pahunch me)', await sees(owner, ann.id));

  // ── 5. "Seen by X of Y" ───────────────────────────────────────────────────
  console.log('\n5) "Seen by" ki ginti');
  await markRead(picked[0], ann.id);
  const rc = await readReceipts(ann.id);
  check(`Y sirf chune hue log hain (${picked.length})`, rc.total === picked.length, `total ${rc.total}`);
  check('X ek hai', rc.seenCount === 1, `seen ${rc.seenCount}`);
  const feed = await listVisible(owner);
  const card = feed.find((a) => String(a.id) === String(ann.id));
  check('feed ka chip bhi wahi kehta hai', card?.reads?.total === picked.length && card?.reads?.seenCount === 1, JSON.stringify(card?.reads));

  // ── 6. Edit ───────────────────────────────────────────────────────────────
  console.log('\n6) Edit');
  await put(ann.id, { title: 'Sirf naam badla' });
  let doc = await Announcement.findById(ann.id).select('audienceUsers audienceRoles title');
  check('sirf title badalne par audience NAHI miti', doc.audienceUsers.length === picked.length, `${doc.audienceUsers.length} bache`);

  const roleKey = all.find((u) => u.role)?.role;
  const teamPost = await post(owner, { title: 'Team wali', body: 'z', audienceRoles: [roleKey] });
  await put(teamPost.id, { audienceRoles: [], audienceUsers: picked.map((u) => String(u._id)) });
  doc = await Announcement.findById(teamPost.id).select('audienceUsers audienceRoles');
  check('Team → Individual par purane roles mit gaye', doc.audienceRoles.length === 0 && doc.audienceUsers.length === picked.length,
    `roles ${doc.audienceRoles.length}, users ${doc.audienceUsers.length}`);
  await put(teamPost.id, { audienceRoles: [roleKey], audienceUsers: [] });
  doc = await Announcement.findById(teamPost.id).select('audienceUsers audienceRoles');
  check('Individual → Team par log mit gaye', doc.audienceUsers.length === 0 && doc.audienceRoles.length === 1);

  // ── 7. Scheduled / repeating ──────────────────────────────────────────────
  console.log('\n7) Scheduled post bhi sirf chune hue logon ko');
  const soon = new Date(Date.now() - 1000); // abhi-abhi due
  const sched = await Announcement.create({
    title: 'Scheduled — teen logon ke liye', body: '', priority: 'NORMAL',
    createdBy: owner._id, audienceUsers: picked.map((u) => u._id), audienceRoles: [],
    publishAt: soon, isActive: true,
  });
  await Notification.deleteMany({ entityType: 'Announcement', entityId: sched._id });
  await publishDueAnnouncements(new Date());
  await sleep(600);
  const schedBells = await Notification.find({ entityType: 'Announcement', entityId: sched._id }).select('user').lean();
  check(`scheduled post ki bell sirf ${picked.length} logon ko gayi`, schedBells.length === picked.length,
    `${schedBells.length} gayi (select() me audienceUsers chhoota to ye ${all.length} hoti)`);

  // ── 8. Validation + picker ka data ────────────────────────────────────────
  console.log('\n8) Validation aur picker ka data');
  let bad = null;
  try { await post(owner, { title: 'x', audienceUsers: [String(new mongoose.Types.ObjectId())] }); } catch (e) { bad = e; }
  check('jo banda hai hi nahi, uspar saaf error', !!bad && /no longer here/i.test(bad.message), bad ? bad.message : 'mana hi nahi kiya');
  let junk = null;
  try { await post(owner, { title: 'x', audienceUsers: ['not-an-id'] }); } catch (e) { junk = e; }
  check('kachre id par validator rokta hai (500 nahi)', junk?.stage === 'validator', junk ? `${junk.stage}` : 'ruka hi nahi');
  const dir = await audiencePeople();
  check('picker ko saare active log milte hain', dir.people.length === all.length + 1, `${dir.people.length} mile`);
  check('picker me avatar nahi aata (payload halka)', !('avatarUrl' in (dir.people[0] || {})));
  check('picker me naam + role label aata hai', !!dir.people[0]?.name && !!dir.people[0]?.roleLabel);

  // safai
  for (const id of [ann.id, legacy.id, teamPost.id, String(sched._id)]) {
    try { await deleteAnnouncement(id); } catch { /* already gone */ }
  }
  await AnnouncementRead.deleteMany({ announcement: { $in: [ann.id] } });

  console.log(`\n${failures ? `❌ ${failures} check fail` : '✅ saare check pass'}\n`);
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('\n💥', e); process.exit(1); });
