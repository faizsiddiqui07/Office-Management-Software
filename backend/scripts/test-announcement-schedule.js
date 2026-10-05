/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * Announcement ko aage ki taarikh/time par set karna. Backend ka ye raasta pehle se bana
 * hua tha (publishAt + publishDueAnnouncements, scheduler se chalta hai) par UI me control
 * hi nahi tha, isliye prod me aaj tak EK BHI scheduled post nahi bani — yaani ye poora
 * raasta kabhi asli data par chala hi nahi. Isliye ye test.
 *
 * Jaancha jaata hai:
 *   1. Waqt aane se pehle: kisi ko na dikhe, na bell jaye
 *   2. Par LIKHNE WALE ko dikhe (warna wo use edit/delete hi nahi kar payega)
 *   3. Waqt aane par apne aap chali jaye — sabko dikhe aur bell bhi jaye
 *   4. Do baar na jaye (scheduler har kuch minute chalta hai)
 *   5. Individual audience ke saath bhi sirf chune hue logon ko
 *   6. Schedule hata dene par turant chali jaye
 *
 *   node scripts/_clone-to-test-db.js --to office_test_sched
 *   node scripts/test-announcement-schedule.js
 */
import 'dotenv/config';

process.env.MONGODB_DB = process.env.MONGODB_DB_TEST || 'office_test_sched';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Announcement } from '../src/models/Announcement.js';
import { Notification } from '../src/models/Notification.js';
import { loadRoles } from '../src/lib/roles.js';
import { createAnnouncementSchema } from '../src/validators/announcements.validators.js';
import {
  createAnnouncement, updateAnnouncement, deleteAnnouncement,
  listVisible, publishDueAnnouncements,
} from '../src/services/announcement.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? `  →  ${extra}` : ''}`);
  if (!cond) failures += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(creator, body) {
  const parsed = createAnnouncementSchema.safeParse(body);
  if (!parsed.success) { const e = new Error(parsed.error.issues.map((i) => i.message).join(', ')); e.stage = 'validator'; throw e; }
  return createAnnouncement(creator, parsed.data);
}
const sees = async (u, id) => (await listVisible(u)).some((a) => String(a.id) === String(id));
const bells = async (id) => Notification.countDocuments({ entityType: 'Announcement', entityId: id });

async function main() {
  await connectDB();
  if (!/test/i.test(mongoose.connection.name)) throw new Error(`refusing: "${mongoose.connection.name}" me "test" nahi hai`);
  await loadRoles();
  console.log(`\n🧪 Isolated DB: ${mongoose.connection.name}\n`);

  const owner = await User.findOne({ role: 'CEO_PRESIDENT', isActive: true }).select('name role');
  const others = await User.find({ isActive: true, _id: { $ne: owner._id } }).select('name role').sort({ name: 1 });

  // ── 1 + 2. Waqt se pehle ──────────────────────────────────────────────────
  console.log('1-2) Waqt aane se PEHLE');
  const future = new Date(Date.now() + 60 * 60 * 1000); // ek ghante baad
  const ann = await post(owner, { title: 'Kal subah wali', body: 'x', audienceRoles: [], publishAt: future.toISOString() });
  await sleep(500);
  let shown = 0;
  for (const u of others) if (await sees(u, ann.id)) { shown += 1; console.log(`     ❌ ${u.name} ko abhi se dikh rahi hai`); }
  check('kisi ko nahi dikhti', shown === 0, `${others.length} log jaanche`);
  check('kisi ko bell nahi gayi', (await bells(ann.id)) === 0);
  check('LIKHNE WALE ko dikhti hai (edit/delete pahunch me)', await sees(owner, ann.id));
  const card = (await listVisible(owner)).find((a) => String(a.id) === String(ann.id));
  check('aur uspar "Goes out ..." ka nishaan hai', !!card?.scheduledFor, card?.scheduledFor ? new Date(card.scheduledFor).toISOString() : 'nahi hai');

  // ── 3. Waqt aane par ──────────────────────────────────────────────────────
  console.log('\n3) Waqt aane par apne aap');
  // Ghadi aage karne ke bajaye post ka waqt peeche kar diya — wahi baat hai.
  await Announcement.updateOne({ _id: ann.id }, { $set: { publishAt: new Date(Date.now() - 1000) } });
  await publishDueAnnouncements(new Date());
  await sleep(700);
  let missed = 0;
  for (const u of others) if (!(await sees(u, ann.id))) { missed += 1; console.log(`     ❌ ${u.name} ko ab bhi nahi dikhi`); }
  check('ab sab ko dikhti hai', missed === 0, `${others.length} log`);
  check('sabko bell gayi', (await bells(ann.id)) === others.length, `${await bells(ann.id)} gayi`);

  // ── 4. Dobara na jaye ─────────────────────────────────────────────────────
  console.log('\n4) Scheduler dobara chale to phir se na jaye');
  const before = await bells(ann.id);
  await publishDueAnnouncements(new Date());
  await publishDueAnnouncements(new Date());
  await sleep(500);
  check('bell ki ginti waisi hi hai', (await bells(ann.id)) === before, `${before} → ${await bells(ann.id)}`);

  // ── 5. Schedule + individual audience ─────────────────────────────────────
  console.log('\n5) Schedule + sirf kuch log');
  const picked = others.slice(0, 2);
  const both = await post(owner, {
    title: 'Baad me, aur sirf do logon ko', body: 'y',
    audienceUsers: picked.map((u) => String(u._id)),
    publishAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  await sleep(400);
  check('abhi kisi ko bell nahi', (await bells(both.id)) === 0);
  await Announcement.updateOne({ _id: both.id }, { $set: { publishAt: new Date(Date.now() - 1000) } });
  await publishDueAnnouncements(new Date());
  await sleep(700);
  check(`waqt aane par bell sirf ${picked.length} logon ko`, (await bells(both.id)) === picked.length, `${await bells(both.id)} gayi`);
  for (const u of picked) check(`${u.name} ko dikhti hai`, await sees(u, both.id));
  const outsider = others.find((u) => !picked.some((p) => String(p._id) === String(u._id)));
  if (outsider) check(`${outsider.name} ko NAHI dikhti`, !(await sees(outsider, both.id)));

  // ── 6. Schedule hata dena ─────────────────────────────────────────────────
  console.log('\n6) Schedule hata dene par turant');
  const later = await post(owner, { title: 'Pehle baad me, phir abhi', body: 'z', audienceRoles: [], publishAt: new Date(Date.now() + 3600e3).toISOString() });
  await sleep(400);
  check('pehle kisi ko nahi dikhti', !(await sees(others[0], later.id)));
  await updateAnnouncement(later.id, { publishAt: null });
  await publishDueAnnouncements(new Date());
  await sleep(700);
  check('schedule hatate hi dikhne lagti hai', await sees(others[0], later.id));

  // safai
  for (const id of [ann.id, both.id, later.id]) { try { await deleteAnnouncement(id); } catch { /* gone */ } }

  console.log(`\n${failures ? `❌ ${failures} check fail` : '✅ saare check pass'}\n`);
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('\n💥', e); process.exit(1); });
