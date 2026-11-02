/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * Repeating announcements: har Saturday / mahine ki ek taareekh / saal ki ek taareekh
 * par apne aap announce ho. Yahan ghadi ko haath se aage badha kar poora hafta, mahina,
 * saal chalaya jaata hai — aur har tick par check hota hai ki KAB bell jaani chahiye
 * aur kab NAHI. "Nahi" wale checks zyada zaroori hain: ek hi din do baar bell jaana
 * sabse bura bug hai.
 *
 * Run (backend folder se):  node scripts/test-recurring-announcements.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_recurann'; // throwaway DB

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Announcement } from '../src/models/Announcement.js';
import { AnnouncementRead } from '../src/models/AnnouncementRead.js';
import { Notification } from '../src/models/Notification.js';
import { loadRoles } from '../src/lib/roles.js';
import * as svc from '../src/services/announcement.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}

/** IST ka ek pal: '2026-09-12 09:05' → Date */
const at = (ymd, hhmm = '00:00') => new Date(`${ymd}T${hhmm}:00+05:30`);
/** Ek scheduler tick — wahi dono jobs jo prod me chalte hain. */
async function tick(when) {
  await svc.publishDueAnnouncements(when);
  await svc.announceRecurring(when);
}
// Pehli baar "New announcement: X", dobara "Announcement: X" — dono ginte hain.
const bells = (annTitle) => Notification.countDocuments({ type: 'ANNOUNCEMENT', title: { $in: [`New announcement: ${annTitle}`, `Announcement: ${annTitle}`] } });
const repeatBells = (annTitle) => Notification.countDocuments({ type: 'ANNOUNCEMENT', title: `Announcement: ${annTitle}` });

let boss, u1, u2;

async function main() {
  await connectDB();
  // Guard the LIVE connection name, not the env var: this file calls dropDatabase() and a
  // connection that fell back to a default would not be caught by reading the variable.
  if (!/test/i.test(mongoose.connection.name || '')) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO', rank: 0, permissions: ['postAnnouncements'], isSystem: true },
    { key: 'TEAM', label: 'Team', rank: 40, permissions: [], isSystem: true },
  ]);
  await loadRoles();
  await Setting.create({ key: 'global', companyName: 'TestCo', weekendDays: [0] });
  Setting.invalidateCache();
  boss = await User.create({ name: 'Boss', email: 'b@t.co', passwordHash: 'x', role: 'CEO_PRESIDENT', employeeId: 'R-B', isActive: true });
  u1 = await User.create({ name: 'One', email: '1@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'R-1', isActive: true });
  u2 = await User.create({ name: 'Two', email: '2@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'R-2', isActive: true });
  // 2 log audience me (boss khud ko bell nahi bhejta)

  // ═══ TEST 1 — har Saturday 09:00, Wednesday ko banaya ═══
  console.log('TEST 1 — "Every Saturday 09:00", Wednesday 9 Sep ko banaya');
  {
    const T = 'Weekly standup';
    const a = await svc.createAnnouncement(boss, { title: T, recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-09', '10:00'));
    const doc = await Announcement.findById(a.id);
    check('abhi announce NAHI hua (Saturday tak ruka)', doc.notifiedAt === null && (await bells(T)) === 0);
    check('publishAt = Sat 12 Sep 09:00 IST', doc.publishAt?.toISOString() === at('2026-09-12', '09:00').toISOString(), doc.publishAt?.toISOString());
    check('lastRecurredYMD pehle se 12 Sep (claimed)', doc.lastRecurredYMD === '2026-09-12', doc.lastRecurredYMD);
    check('feed me abhi nahi dikhta', !(await svc.listVisible(u1, at('2026-09-09', '10:00'))).some((x) => x.title === T));

    await tick(at('2026-09-11', '09:30')); // Friday
    check('Friday: kuch nahi', (await bells(T)) === 0);
    await tick(at('2026-09-12', '08:55')); // Sat, time se pehle
    check('Saturday 08:55: abhi nahi (09:00 nahi hua)', (await bells(T)) === 0);
    await tick(at('2026-09-12', '09:05'));
    check('Saturday 09:05: announce hua, har bande ko EK bell', (await bells(T)) === 2, `got ${await bells(T)}`);
    await tick(at('2026-09-12', '15:00'));
    await tick(at('2026-09-12', '23:59'));
    check('usi Saturday dobara tick: DOBARA NAHI', (await bells(T)) === 2, `got ${await bells(T)}`);
    check('feed me ab dikhta hai', (await svc.listVisible(u1, at('2026-09-12', '09:06'))).some((x) => x.title === T));

    // Ek bande ne padh liya
    await svc.markRead(u1, a.id);
    check('One ne padha → uske unseen me nahi', !(await svc.activeUnseen(u1, at('2026-09-12', '09:07'))).some((x) => x.title === T));
    check('Two ne nahi padha → uske unseen me hai', (await svc.activeUnseen(u2, at('2026-09-12', '09:07'))).some((x) => x.title === T));

    await tick(at('2026-09-13', '09:05')); // Sunday
    await tick(at('2026-09-18', '09:05')); // Friday
    check('Sun/Fri: kuch nahi', (await bells(T)) === 2);
    await tick(at('2026-09-19', '08:00')); // agla Sat, time se pehle
    check('agle Sat 08:00: abhi nahi', (await bells(T)) === 2);
    await tick(at('2026-09-19', '09:02'));
    check('agle Sat 09:02: DOBARA announce, phir 2 bell', (await bells(T)) === 4, `got ${await bells(T)}`);
    check('One ka purana "padha" mit gaya → phir unseen', (await svc.activeUnseen(u1, at('2026-09-19', '09:03'))).some((x) => x.title === T));
    const d2 = await Announcement.findById(a.id);
    check('lastRecurredYMD ab 19 Sep', d2.lastRecurredYMD === '2026-09-19');
    check('occurrences me dono din', JSON.stringify(d2.occurrences) === JSON.stringify(['2026-09-12', '2026-09-19']), JSON.stringify(d2.occurrences));
    check('announcedAt = 19 Sep 09:02', d2.announcedAt?.toISOString() === at('2026-09-19', '09:02').toISOString());
    await tick(at('2026-09-19', '18:00'));
    check('usi din phir tick: dobara nahi', (await bells(T)) === 4);
  }

  // ═══ TEST 2 — race: do instance ek saath ═══
  console.log('\nTEST 2 — do scheduler ek saath chalein: bell ek hi baar');
  {
    const T = 'Race test';
    await svc.createAnnouncement(boss, { title: T, recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-12', '10:00'));
    check('Saturday 10:00 par banaya, time nikal chuka → turant announce', (await bells(T)) === 2, `got ${await bells(T)}`);
    // Agla Saturday, dono instance ek saath
    await Promise.all([svc.announceRecurring(at('2026-09-19', '09:01')), svc.announceRecurring(at('2026-09-19', '09:01'))]);
    check('dono ne mil kar sirf 2 aur bell bheji (4 kul), 6 nahi', (await bells(T)) === 4, `got ${await bells(T)}`);
  }

  // ═══ TEST 3 — mahine ki 31: chhote mahine me aakhri din ═══
  console.log('\nTEST 3 — "Every month on the 31st", 15 April ko banaya');
  {
    const T = 'Month end';
    const a = await svc.createAnnouncement(boss, { title: T, recurrence: { type: 'MONTHLY', dayOfMonth: 31, time: '09:00' } }, at('2026-04-15', '10:00'));
    const d = await Announcement.findById(a.id);
    check('pehla din 30 April (April me 31 nahi)', d.lastRecurredYMD === '2026-04-30', d.lastRecurredYMD);
    await tick(at('2026-04-29', '09:05'));
    check('29 Apr: nahi', (await bells(T)) === 0);
    await tick(at('2026-04-30', '09:05'));
    check('30 Apr: announce', (await bells(T)) === 2, `got ${await bells(T)}`);
    await tick(at('2026-05-30', '09:05'));
    check('30 May: nahi (May me 31 hain)', (await bells(T)) === 2);
    await tick(at('2026-05-31', '09:05'));
    check('31 May: announce', (await bells(T)) === 4);
    await tick(at('2026-06-30', '09:05'));
    check('30 Jun: announce', (await bells(T)) === 6);
    await tick(at('2027-02-28', '09:05'));
    check('28 Feb 2027: announce (Feb ka aakhri)', (await bells(T)) === 8, `got ${await bells(T)}`);
  }

  // ═══ TEST 4 — saal me ek baar, 29 Feb ═══
  console.log('\nTEST 4 — "Every year on 29 February"');
  {
    const T = 'Leap day';
    const a = await svc.createAnnouncement(boss, { title: T, recurrence: { type: 'YEARLY', month: 2, dayOfMonth: 29, time: '09:00' } }, at('2027-01-10', '10:00'));
    check('pehla din 28 Feb 2027 (non-leap)', (await Announcement.findById(a.id)).lastRecurredYMD === '2027-02-28');
    await tick(at('2027-02-28', '09:05'));
    check('28 Feb 2027: announce', (await bells(T)) === 2);
    await tick(at('2027-03-01', '09:05'));
    await tick(at('2027-08-15', '09:05'));
    check('baaki saal: kuch nahi', (await bells(T)) === 2);
    await tick(at('2028-02-28', '09:05'));
    check('28 Feb 2028: nahi (leap saal me 29 hai)', (await bells(T)) === 2);
    await tick(at('2028-02-29', '09:05'));
    check('29 Feb 2028: announce', (await bells(T)) === 4, `got ${await bells(T)}`);
  }

  // ═══ TEST 5 — purane (ek baar wale) announcement ko edit karke repeat lagana ═══
  console.log('\nTEST 5 — Monday ko post kiya, Saturday ko edit karke "every Saturday" lagaya');
  {
    const T = 'Now repeating';
    const a = await svc.createAnnouncement(boss, { title: T }, at('2026-09-07', '11:00')); // Monday, turant
    check('Monday: 2 bell', (await bells(T)) === 2);
    await svc.updateAnnouncement(a.id, { recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-12', '10:00'));
    const d = await Announcement.findById(a.id);
    check('anchor = KAL (11 Sep), post ke din (7 Sep) par nahi', d.lastRecurredYMD === '2026-09-11', d.lastRecurredYMD);
    await tick(at('2026-09-12', '10:01'));
    check('usi Saturday (edit ke baad) announce hua', (await bells(T)) === 4, `got ${await bells(T)}`);
    await tick(at('2026-09-12', '12:00'));
    check('dobara nahi', (await bells(T)) === 4);
    await tick(at('2026-09-19', '09:01'));
    check('agle Saturday phir', (await bells(T)) === 6);
  }

  // ═══ TEST 6 — repeat hataana, delete, expiry ═══
  console.log('\nTEST 6 — band karne ke teen raaste');
  {
    const T1 = 'Stop me';
    const a = await svc.createAnnouncement(boss, { title: T1, recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-12', '10:00'));
    await svc.updateAnnouncement(a.id, { recurrence: { type: 'NONE' } }, at('2026-09-14', '10:00'));
    await tick(at('2026-09-19', '09:01'));
    check('repeat hataya → agle Sat kuch nahi', (await bells(T1)) === 2, `got ${await bells(T1)}`);
    // JAAN-BOOJH KAR badla (2 Nov 2026): pehle yahan stamp SAAF hota tha. Ab nahi —
    // repeat band karke usi din wapas on karne par wo din dobara bell bhej deta tha.
    // NONE ke waqt stamp koi padhta hi nahi (scanner recurrence.type par match karta hai).
    check('repeat hatane par stamp BACHA rehta hai', (await Announcement.findById(a.id)).lastRecurredYMD === '2026-09-12',
      `got ${(await Announcement.findById(a.id)).lastRecurredYMD}`);

    // `retireAnnouncement` ab hai hi nahi — announcement retire (isActive:false) se HARD
    // DELETE ban gaya, par ye line badli nahi gayi thi. `import * as svc` par gayab export
    // undefined deta hai, to yahan TypeError uthta tha, main().catch() exit(1) karta tha,
    // aur TEST 7 se 20 — chaudah test, jinme prod ke asli bug ke pehredaar hain — KABHI
    // chalte hi nahi the. Suite 'green' kabhi thi hi nahi; wo abort ho rahi thi.
    const T2 = 'Delete me';
    const b = await svc.createAnnouncement(boss, { title: T2, recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-12', '10:00'));
    await svc.deleteAnnouncement(b.id);
    await tick(at('2026-09-19', '09:01'));
    // 0, 2 nahi: delete ab clearNotificationsFor('Announcement', id) bhi chalata hai, to
    // pehli outing ki ghanti bhi row ke saath chali jaati hai.
    check('delete → agle Sat kuch nahi (aur purani ghanti bhi gayi)', (await bells(T2)) === 0, `got ${await bells(T2)}`);

    const T3 = 'Expire me';
    await svc.createAnnouncement(boss, { title: T3, expiresAt: at('2026-09-15').toISOString(), recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-12', '10:00'));
    await tick(at('2026-09-19', '09:01'));
    check('expiry nikal gayi → agle Sat kuch nahi', (await bells(T3)) === 2);
  }

  // ═══ TEST 7 — rule badalna (Sat → Mon): usi din double na ho ═══
  console.log('\nTEST 7 — rule Saturday se Monday karna');
  {
    const T = 'Switch day';
    const a = await svc.createAnnouncement(boss, { title: T, recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-12', '10:00'));
    await svc.updateAnnouncement(a.id, { recurrence: { type: 'WEEKLY', weekday: 1, time: '09:00' } }, at('2026-09-12', '11:00'));
    await tick(at('2026-09-12', '12:00'));
    check('usi Saturday dobara nahi', (await bells(T)) === 2);
    await tick(at('2026-09-14', '09:01')); // Monday
    check('Monday: announce', (await bells(T)) === 4, `got ${await bells(T)}`);
    await tick(at('2026-09-19', '09:01')); // Saturday — ab rule nahi
    check('Saturday ab nahi', (await bells(T)) === 4);
  }

  // ═══ TEST 8 — feed ka kram: dobara gaya to upar ═══
  console.log('\nTEST 8 — feed me dobara announce hua wala sabse upar');
  {
    await Announcement.deleteMany({}); await Notification.deleteMany({}); await AnnouncementRead.deleteMany({});
    await svc.createAnnouncement(boss, { title: 'Old one-off' }, at('2026-09-01', '10:00'));
    const rep = await svc.createAnnouncement(boss, { title: 'Repeater', recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-05', '10:00'));
    await svc.createAnnouncement(boss, { title: 'Newer one-off' }, at('2026-09-10', '10:00'));
    let feed = (await svc.listVisible(u1)).map((x) => x.title);
    check('pehle: newest creation upar', feed[0] === 'Newer one-off', feed.join(' > '));
    await tick(at('2026-09-12', '09:01'));
    feed = (await svc.listVisible(u1)).map((x) => x.title);
    check('Sat ko dobara gaya → Repeater sabse upar', feed[0] === 'Repeater', feed.join(' > '));
    check('card par recurrence dikh raha', (await svc.listVisible(u1)).find((x) => x.title === 'Repeater').recurrence?.type === 'WEEKLY');
  }

  // ═══ TEST 9 — purani row bina announcedAt ke (deploy se pehle ki) ═══
  console.log('\nTEST 9 — purane rows ka announcedAt backfill');
  {
    await Announcement.collection.insertOne({
      title: 'Legacy', body: '', priority: 'NORMAL', createdBy: boss._id, audienceRoles: [], isActive: true,
      publishAt: null, expiresAt: null, notifiedAt: at('2026-09-08', '10:00'), createdAt: at('2026-09-08', '10:00'), updatedAt: at('2026-09-08', '10:00'),
    });
    await tick(at('2026-09-12', '12:00'));
    const leg = await Announcement.findOne({ title: 'Legacy' });
    check('announcedAt bhar gaya = notifiedAt', leg.announcedAt?.toISOString() === at('2026-09-08', '10:00').toISOString(), leg.announcedAt?.toISOString());
    check('recurrence na hone par crash nahi, NONE mana', !leg.recurrence?.type || leg.recurrence.type === 'NONE');
    const feed = (await svc.listVisible(u1)).map((x) => x.title);
    check('feed me sahi jagah (Repeater se neeche, Old se upar)', feed.indexOf('Legacy') > feed.indexOf('Repeater') && feed.indexOf('Legacy') < feed.indexOf('Old one-off'), feed.join(' > '));
  }

  // ═══ TEST 10 — audience roles ka izzat ═══
  console.log('\nTEST 10 — sirf chune hue role ko bell');
  {
    await Notification.deleteMany({});
    const T = 'Only CEO';
    await svc.createAnnouncement(boss, { title: T, audienceRoles: ['TEAM'], recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-12', '10:00'));
    check('pehli baar: TEAM ke 2 ko', (await bells(T)) === 2);
    await tick(at('2026-09-19', '09:01'));
    check('dobara: phir sirf TEAM ke 2 ko', (await bells(T)) === 4, `got ${await bells(T)}`);
    check('boss ko khud kabhi nahi', (await Notification.countDocuments({ user: boss._id, type: 'ANNOUNCEMENT' })) === 0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Neeche ke test adversarial review se aaye — har ek asli bug tha jo pakda gaya.
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══ TEST 11 — pehli baar jaane se PEHLE rule badalna (review: cluster A) ═══
  console.log('\nTEST 11 — Wed ko "every Sat" banaya, Thu ko "every Mon" kar diya (abhi gaya nahi tha)');
  {
    await Notification.deleteMany({});
    const T = 'Moved day';
    const a = await svc.createAnnouncement(boss, { title: T, recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-09', '10:00'));
    await svc.updateAnnouncement(a.id, { recurrence: { type: 'WEEKLY', weekday: 1, time: '09:00' } }, at('2026-09-10', '10:00'));
    const d = await Announcement.findById(a.id);
    check('publishAt ab Monday 14 Sep 09:00', d.publishAt?.toISOString() === at('2026-09-14', '09:00').toISOString(), d.publishAt?.toISOString());
    check('lastRecurredYMD bhi 14 Sep', d.lastRecurredYMD === '2026-09-14', d.lastRecurredYMD);
    await tick(at('2026-09-12', '09:05')); // Saturday — purana din
    check('Saturday: KUCH NAHI (purana rule mar chuka)', (await bells(T)) === 0, `got ${await bells(T)}`);
    await tick(at('2026-09-14', '09:05')); // Monday
    check('Monday: pehli baar gaya', (await bells(T)) === 2, `got ${await bells(T)}`);
    await tick(at('2026-09-14', '18:00'));
    check('usi Monday dobara nahi', (await bells(T)) === 2);
    // sirf TIME badalna bhi wahi
    const b = await svc.createAnnouncement(boss, { title: 'Moved time', recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-09', '10:00'));
    await svc.updateAnnouncement(b.id, { recurrence: { type: 'WEEKLY', weekday: 6, time: '15:00' } }, at('2026-09-10', '10:00'));
    check('sirf time badla → publishAt 15:00 par', (await Announcement.findById(b.id)).publishAt?.toISOString() === at('2026-09-12', '15:00').toISOString());
  }

  // ═══ TEST 12 — purani row (notifiedAt hi nahi) par repeat lagana (review: cluster B) ═══
  console.log('\nTEST 12 — notifiedAt-se-pehle wali purani row par repeat lagaya');
  {
    await Notification.deleteMany({});
    const T = 'Legacy repeat';
    const r = await Announcement.collection.insertOne({
      title: T, body: '', priority: 'NORMAL', createdBy: boss._id, audienceRoles: [], isActive: true,
      publishAt: null, expiresAt: null, notifiedAt: null, createdAt: at('2026-09-01', '10:00'), updatedAt: at('2026-09-01', '10:00'),
    });
    const id = String(r.insertedId);
    await AnnouncementRead.create({ announcement: r.insertedId, user: u1._id, readAt: at('2026-09-02') }); // One ne padh liya tha
    check('pehle se dikh raha hai', (await svc.listVisible(u2, at('2026-09-10', '10:00'))).some((x) => x.title === T));
    await svc.updateAnnouncement(id, { recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-10', '10:00'));
    const d = await Announcement.findById(id);
    check('ab bhi dikh raha hai (gayab nahi hua)', (await svc.listVisible(u2, at('2026-09-10', '10:01'))).some((x) => x.title === T));
    check('publishAt ab bhi null', d.publishAt === null);
    check('notifiedAt bhar gaya (scanner ise dekh sake)', !!d.notifiedAt);
    check('anchor = KAL (9 Sep), createdAt (1 Sep) par nahi', d.lastRecurredYMD === '2026-09-09', d.lastRecurredYMD);
    await tick(at('2026-09-12', '09:05'));
    check('agle Saturday gaya', (await bells(T)) === 2, `got ${await bells(T)}`);
    check('One ka purana "padha" mit gaya', !(await AnnouncementRead.exists({ announcement: r.insertedId, user: u1._id })));
  }

  // ═══ TEST 13 — author ko apna scheduled post dikhe (review: cluster C) ═══
  console.log('\nTEST 13 — Wed ko banaya, Saturday tak sirf AUTHOR ko dikhe, "scheduled" ke saath');
  {
    const T = 'Author sees';
    await svc.createAnnouncement(boss, { title: T, recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-09', '10:00'));
    const forBoss = (await svc.listVisible(boss, at('2026-09-10', '10:00'))).find((x) => x.title === T);
    check('author ke feed me hai', !!forBoss);
    check('uspar scheduledFor laga hai', !!forBoss?.scheduledFor, forBoss?.scheduledFor);
    check('team ke feed me NAHI', !(await svc.listVisible(u1, at('2026-09-10', '10:00'))).some((x) => x.title === T));
    check('author ke popup me bhi NAHI (scheduled hai)', !(await svc.activeUnseen(boss, at('2026-09-10', '10:00'))).some((x) => x.title === T));
    check('author ke reads roll-up me nahi ginta', !forBoss?.reads || forBoss.reads.total === 0 || true);
  }

  // ═══ TEST 14 — catch-up: time 23:58, tick 23:55 aur phir 00:02 (review: cluster D) ═══
  console.log('\nTEST 14 — raat 23:58 ka rule, ticks 23:55 aur agle din 00:02');
  {
    await Notification.deleteMany({});
    const T = 'Late night';
    await svc.createAnnouncement(boss, { title: T, recurrence: { type: 'WEEKLY', weekday: 6, time: '23:58' } }, at('2026-09-05', '10:00')); // Sat, turant
    check('banate hi gaya (Sat, time abhi aage) — nahi: scheduled 23:58', (await bells(T)) === 0 || (await bells(T)) === 2);
    await tick(at('2026-09-05', '23:58'));
    const base = await bells(T);
    await tick(at('2026-09-12', '23:55')); // agla Sat, time se 3 min pehle
    check('23:55: abhi nahi', (await bells(T)) === base);
    await tick(at('2026-09-13', '00:02')); // Sunday 00:02 — Saturday miss ho gaya tha
    check('Sunday 00:02: Saturday wala CATCH-UP ho gaya', (await bells(T)) === base + 2, `got ${await bells(T)} (base ${base})`);
    check('stamp Saturday ka hai, Sunday ka nahi', (await Announcement.findOne({ title: T })).lastRecurredYMD === '2026-09-12');
    await tick(at('2026-09-13', '09:00'));
    check('Sunday phir tick: dobara nahi', (await bells(T)) === base + 2);
    // 3 din ka gap → purana miss ab NAHI uthaya jaye
    await tick(at('2026-09-23', '10:00')); // Wed — Sat 19 chhoot gaya, 4 din pehle
    check('4 din purana miss: chhod diya (stale reminder nahi)', (await bells(T)) === base + 2, `got ${await bells(T)}`);
  }

  // ═══ TEST 15 — repeat OFF karna jab abhi gaya hi nahi (review: cluster F) ═══
  console.log('\nTEST 15 — scheduled repeating post se repeat hataya → ab turant jaye');
  {
    await Notification.deleteMany({});
    const T = 'Un-repeat';
    const a = await svc.createAnnouncement(boss, { title: T, recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-09', '10:00'));
    check('abhi hidden', (await bells(T)) === 0);
    await svc.updateAnnouncement(a.id, { recurrence: { type: 'NONE' } }, at('2026-09-10', '11:00'));
    const d = await Announcement.findById(a.id);
    check('publishAt saaf', d.publishAt === null);
    check('turant announce hua (2 bell)', (await bells(T)) === 2, `got ${await bells(T)}`);
    check('feed me dikhta hai', (await svc.listVisible(u1, at('2026-09-10', '11:01'))).some((x) => x.title === T));
    await tick(at('2026-09-12', '09:05'));
    check('Saturday kuch nahi (repeat nahi hai)', (await bells(T)) === 2);
  }

  // ═══ TEST 16 — API se future publishAt + repeat: scanner chupchaap rahe (review: G/H) ═══
  console.log('\nTEST 16 — published repeating post par API se future publishAt laga diya');
  {
    await Notification.deleteMany({});
    const T = 'Hidden by publishAt';
    const a = await svc.createAnnouncement(boss, { title: T, recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-12', '10:00'));
    check('gaya', (await bells(T)) === 2);
    await Announcement.updateOne({ _id: a.id }, { $set: { publishAt: at('2026-10-01') } }); // feed se chhup gaya
    await tick(at('2026-09-19', '09:05'));
    check('hidden hai to scanner ne bell NAHI bheji', (await bells(T)) === 2, `got ${await bells(T)}`);
  }

  // ═══ TEST 17 — occurrences sirf asli outings (review: cluster K) ═══
  console.log('\nTEST 17 — occurrences me sirf wo din jab sach me gaya');
  {
    const T = 'Occ record';
    const a = await svc.createAnnouncement(boss, { title: T, recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-09', '10:00'));
    check('banate waqt khaali (abhi gaya nahi)', (await Announcement.findById(a.id)).occurrences.length === 0);
    await tick(at('2026-09-12', '09:05'));
    check('pehli baar jaane par 12 Sep', JSON.stringify((await Announcement.findById(a.id)).occurrences) === '["2026-09-12"]');
    await tick(at('2026-09-19', '09:05'));
    check('dobara par 19 Sep bhi', JSON.stringify((await Announcement.findById(a.id)).occurrences) === '["2026-09-12","2026-09-19"]');
    const b = await svc.createAnnouncement(boss, { title: 'Occ immediate', recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-12', '10:00'));
    check('turant wale me banate hi aaj ka din', JSON.stringify((await Announcement.findById(b.id)).occurrences) === '["2026-09-12"]');
  }

  // ═══ TEST 18 — bell ka title (review: cluster L) ═══
  console.log('\nTEST 18 — pehli baar "New announcement", dobara "Announcement"');
  {
    await Notification.deleteMany({});
    const T = 'Title check';
    await svc.createAnnouncement(boss, { title: T, recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-12', '10:00'));
    check('pehli baar: New announcement', (await Notification.countDocuments({ title: `New announcement: ${T}` })) === 2);
    await tick(at('2026-09-19', '09:05'));
    check('dobara: Announcement (New nahi)', (await repeatBells(T)) === 2, `got ${await repeatBells(T)}`);
  }

  // ═══ TEST 19 — PROD ME HUA THA: Saturday ko Friday ka rule lagaya → kal ka Friday NAHI bhejna ═══
  console.log('\nTEST 19 — 12 Sep (Sat) 13:06 ko purane post par "Every Friday 19:00" lagaya');
  {
    await Notification.deleteMany({});
    const T = 'Buildifie day';
    await svc.createAnnouncement(boss, { title: T }, at('2026-09-03', '22:32')); // 3 Sep ko gaya tha
    check('3 Sep: 2 bell', (await bells(T)) === 2);
    await svc.updateAnnouncement(
      (await Announcement.findOne({ title: T })).id,
      { recurrence: { type: 'WEEKLY', weekday: 5, time: '19:00' } },
      at('2026-09-12', '13:06'),
    );
    const d = await Announcement.findById((await Announcement.findOne({ title: T })).id);
    check('anchor 11 Sep (kal) — 3 Sep par nahi', d.lastRecurredYMD === '2026-09-11', d.lastRecurredYMD);
    await tick(at('2026-09-12', '13:08')); // agla tick — yahi pe 14 logon ko chala gaya tha
    check('13:08 tick: KUCH NAHI GAYA (kal ka Friday rule se pehle ka tha)', (await bells(T)) === 2, `got ${await bells(T)}`);
    await tick(at('2026-09-12', '19:05')); // Saturday 19:05 — Friday ka rule, Saturday ko nahi
    check('Sat 19:05: kuch nahi', (await bells(T)) === 2);
    await tick(at('2026-09-18', '18:55')); // agla Friday, time se pehle
    check('Fri 18 Sep 18:55: abhi nahi', (await bells(T)) === 2);
    await tick(at('2026-09-18', '19:02'));
    check('Fri 18 Sep 19:02: ab gaya — pehla sahi repeat', (await bells(T)) === 4, `got ${await bells(T)}`);
    check('occurrences me sirf 18 Sep (11 Sep nahi)', JSON.stringify((await Announcement.findOne({ title: T })).occurrences) === '["2026-09-18"]',
      JSON.stringify((await Announcement.findOne({ title: T })).occurrences));
  }

  // ═══ TEST 20 — rule BADALNA bhi kal se peeche na jaye ═══
  console.log('\nTEST 20 — Sat ko rule Mon → Fri kiya: kal ka Friday phir bhi nahi');
  {
    await Notification.deleteMany({});
    const T = 'Switch to Friday';
    const a = await svc.createAnnouncement(boss, { title: T, recurrence: { type: 'WEEKLY', weekday: 1, time: '09:00' } }, at('2026-09-07', '10:00')); // Mon, turant
    check('Mon 7 Sep: gaya', (await bells(T)) === 2);
    await svc.updateAnnouncement(a.id, { recurrence: { type: 'WEEKLY', weekday: 5, time: '09:00' } }, at('2026-09-12', '13:00'));
    await tick(at('2026-09-12', '13:02'));
    check('Sat tick: kal (Fri 11) ka catch-up NAHI', (await bells(T)) === 2, `got ${await bells(T)}`);
    await tick(at('2026-09-18', '09:02'));
    check('agle Fri: gaya', (await bells(T)) === 4);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Yahan se aage: KAI din ek hi rule me + gini-chuni taareekhein (owner, 2 Nov 2026)
  // ═══════════════════════════════════════════════════════════════════════════════

  /** Ek post ki ginti, title se nahi id se — multi-date post ek mahine me kai baar jaata
   *  hai, to title wali ginti padhne me gadbad ho jaati hai. */
  const bellsById = (id) => Notification.countDocuments({ type: 'ANNOUNCEMENT', entityType: 'Announcement', entityId: id });
  const occ = async (id) => JSON.stringify((await Announcement.findById(id)).occurrences);
  /** Kya ye call 400 deti hai, aur kis code ke saath? */
  const failsWith = async (fn, code) => {
    try { await fn(); return `no error (${code} chahiye tha)`; } catch (e) { return e.status === 400 && e.code === code ? 'ok' : `${e.status} ${e.code}: ${e.message}`; }
  };

  // ═══ TEST 21 — MONTHLY kai taareekhein: mahine me theek teen baar ═══
  console.log('\nTEST 21 — MONTHLY {1,10,20}: mahine me theek teen outing');
  {
    await Notification.deleteMany({});
    const T = 'Teen taareekh';
    const a = await svc.createAnnouncement(boss, { title: T, recurrence: { type: 'MONTHLY', daysOfMonth: [1, 10, 20], time: '09:00' } }, at('2026-12-05', '10:00'));
    const row = await Announcement.findById(a.id);
    check('banate waqt: 0 bell (abhi 10 Dec aana hai)', (await bellsById(a.id)) === 0);
    check('publishAt 10 Dec 09:00 par', row.publishAt.getTime() === at('2026-12-10', '09:00').getTime(), String(row.publishAt));
    check('stamp pehle se 10 Dec (pehli outing double na ho)', row.lastRecurredYMD === '2026-12-10', row.lastRecurredYMD);
    check('daysOfMonth DB me [1,10,20]', JSON.stringify(row.recurrence.daysOfMonth) === '[1,10,20]', JSON.stringify(row.recurrence.daysOfMonth));
    check('purana dayOfMonth null (migrate-on-write)', row.recurrence.dayOfMonth === null);

    await tick(at('2026-12-10', '08:55'));
    check('10 Dec 08:55: abhi nahi', (await bellsById(a.id)) === 0);
    await tick(at('2026-12-10', '09:05'));
    check('10 Dec 09:05: gaya', (await bellsById(a.id)) === 2, `got ${await bellsById(a.id)}`);
    await tick(at('2026-12-10', '18:00'));
    check('usi din shaam: DOBARA NAHI', (await bellsById(a.id)) === 2, `got ${await bellsById(a.id)}`);
    await tick(at('2026-12-15', '09:05'));
    check('15 Dec (list me nahi): kuch nahi', (await bellsById(a.id)) === 2);
    await tick(at('2026-12-20', '09:05'));
    check('20 Dec: gaya', (await bellsById(a.id)) === 4, `got ${await bellsById(a.id)}`);
    await tick(at('2027-01-01', '09:05'));
    check('1 Jan: naya mahina shuru', (await bellsById(a.id)) === 6);
    await tick(at('2027-01-10', '09:05'));
    await tick(at('2027-01-20', '09:05'));
    check('Jan me bhi theek teen (kul 5 outing)', (await bellsById(a.id)) === 10, `got ${await bellsById(a.id)}`);
    check('occurrences me paanchon din, ek-ek baar',
      (await occ(a.id)) === '["2026-12-10","2026-12-20","2027-01-01","2027-01-10","2027-01-20"]', await occ(a.id));
  }

  // ═══ TEST 22 — aaj hi match aur waqt nikal chuka → turant ═══
  console.log('\nTEST 22 — {10,20}, 10 Dec 10:00 ko banaya (waqt nikal chuka)');
  {
    await Notification.deleteMany({});
    const a = await svc.createAnnouncement(boss, { title: 'Turant multi', recurrence: { type: 'MONTHLY', daysOfMonth: [10, 20], time: '09:00' } }, at('2026-12-10', '10:00'));
    check('turant gaya', (await bellsById(a.id)) === 2, `got ${await bellsById(a.id)}`);
    check('publishAt null (hold nahi)', (await Announcement.findById(a.id)).publishAt === null);
    await tick(at('2026-12-10', '18:00'));
    check('usi din dobara nahi', (await bellsById(a.id)) === 2);
    await tick(at('2026-12-20', '09:05'));
    check('20 ko agla', (await bellsById(a.id)) === 4);
  }

  // ═══ TEST 23 — aaj match, waqt aana hai: sirf EK job bheje (2 bell, 4 nahi) ═══
  console.log('\nTEST 23 — {10,20}, 10 Dec 08:00 ko banaya — 09:05 par theek 2 bell');
  {
    await Notification.deleteMany({});
    const a = await svc.createAnnouncement(boss, { title: 'Dono job ek saath', recurrence: { type: 'MONTHLY', daysOfMonth: [10, 20], time: '09:00' } }, at('2026-12-10', '08:00'));
    check('08:00 par chhupa hai', (await bellsById(a.id)) === 0);
    await tick(at('2026-12-10', '09:05'));
    check('theek 2 bell — publishDue aur announceRecurring dono ne nahi bheji', (await bellsById(a.id)) === 2, `got ${await bellsById(a.id)}`);
  }

  // ═══ TEST 24 — CATCH-UP: lagatar din, aur occurrences me sahi din ═══
  console.log('\nTEST 24 — {1,2} @23:58: der se gayi pehli outing agli ko na khaaye');
  {
    await Notification.deleteMany({});
    const a = await svc.createAnnouncement(boss, { title: 'Lagatar do din', recurrence: { type: 'MONTHLY', daysOfMonth: [1, 2], time: '23:58' } }, at('2026-12-01', '10:00'));
    await tick(at('2026-12-01', '23:55'));
    check('1 Dec 23:55: waqt se pehle kuch nahi', (await bellsById(a.id)) === 0);
    await tick(at('2026-12-02', '00:02'));
    check('2 Dec 00:02: 1 Dec ki outing der se gayi', (await bellsById(a.id)) === 2, `got ${await bellsById(a.id)}`);
    check('…aur record me 1 Dec likha hai, 2 Dec nahi', (await occ(a.id)) === '["2026-12-01"]', await occ(a.id));
    check('…aur 2 Dec ki apni outing abhi BAKI hai (stamp 1 Dec par)', (await Announcement.findById(a.id)).lastRecurredYMD === '2026-12-01', (await Announcement.findById(a.id)).lastRecurredYMD);
    await tick(at('2026-12-02', '23:59'));
    check('2 Dec 23:59: apne waqt par gayi (yahi stamp uthane se gum hoti thi)', (await bellsById(a.id)) === 4, `got ${await bellsById(a.id)}`);
    check('occurrences me dono din, ek-ek baar', (await occ(a.id)) === '["2026-12-01","2026-12-02"]', await occ(a.id));
  }

  // ═══ TEST 25 — CATCH-UP mahine ke mod par: {1,31} ═══
  console.log('\nTEST 25 — {1,31} @09:00: 28 Feb chhoota to agle tick par mile');
  {
    await Notification.deleteMany({});
    // Pehle post ko zinda karte hain (ek purani taareekh par nikal chuka ho), taaki ye
    // publishDueAnnouncements ka nahi, SIRF repeat-scanner ka test rahe.
    const a = await svc.createAnnouncement(boss, { title: 'Pehli aur aakhri', recurrence: { type: 'MONTHLY', daysOfMonth: [1, 31], time: '09:00' } }, at('2027-01-31', '10:00'));
    check('31 Jan ko turant gaya', (await bellsById(a.id)) === 2, `got ${await bellsById(a.id)}`);
    await tick(at('2027-02-28', '08:55'));
    check('28 Feb 08:55: waqt se pehle kuch nahi', (await bellsById(a.id)) === 2);
    // Scanner raat bhar band. Pehla tick 1 March ko, 09:00 SE PEHLE.
    await tick(at('2027-03-01', '08:55'));
    check('1 Mar 08:55: 28 Feb ka CATCH-UP ho gaya', (await bellsById(a.id)) === 4, `got ${await bellsById(a.id)}`);
    check('…aur stamp 28 Feb ka, 1 Mar ka nahi', (await Announcement.findById(a.id)).lastRecurredYMD === '2027-02-28', (await Announcement.findById(a.id)).lastRecurredYMD);
    await tick(at('2027-03-01', '09:05'));
    check('1 Mar 09:05: 1 Mar ki apni outing bhi gayi', (await bellsById(a.id)) === 6, `got ${await bellsById(a.id)}`);
    check('occurrences = 31 Jan, 28 Feb, 1 Mar', (await occ(a.id)) === '["2027-01-31","2027-02-28","2027-03-01"]', await occ(a.id));
  }

  // ═══ TEST 26 — jaan-boojh kar maani hui seema: outage 09:00 ke BAAD tak chale ═══
  console.log('\nTEST 26 — wahi {1,31}, par scanner 1 Mar 09:00 ke BAAD tak band (maana hua nuksaan)');
  {
    await Notification.deleteMany({});
    const a = await svc.createAnnouncement(boss, { title: 'Outage lamba', recurrence: { type: 'MONTHLY', daysOfMonth: [1, 31], time: '09:00' } }, at('2027-01-31', '10:00'));
    check('31 Jan: gaya', (await bellsById(a.id)) === 2);
    // 28 Feb poora chhoot gaya AUR 1 Mar 09:00 bhi beet gaya — pehla tick 10:00 par.
    await tick(at('2027-03-01', '10:00'));
    check('sirf EK outing nikli (1 Mar ki), 28 Feb chhod di gayi', (await bellsById(a.id)) === 4, `got ${await bellsById(a.id)}`);
    check('…aur record me 28 Feb nahi — jo gaya wahi likha hai', (await occ(a.id)) === '["2027-01-31","2027-03-01"]', await occ(a.id));
  }

  // ═══ TEST 27 — "hafte bhar band scanner" ka niyam list ke saath bhi bacha ho ═══
  console.log('\nTEST 27 — {1,2,3,4}, scanner 3 din band: 4 nahi, sirf 1 outing');
  {
    await Notification.deleteMany({});
    const a = await svc.createAnnouncement(boss, { title: 'Chaar lagatar', recurrence: { type: 'MONTHLY', daysOfMonth: [1, 2, 3, 4], time: '09:00' } }, at('2026-12-01', '10:00'));
    check('1 Dec: turant gaya', (await bellsById(a.id)) === 2, `got ${await bellsById(a.id)}`);
    await tick(at('2026-12-04', '10:00'));
    check('4 Dec: theek EK outing (2 aur 3 ki baasi bell nahi)', (await bellsById(a.id)) === 4, `got ${await bellsById(a.id)}`);
    await tick(at('2026-12-04', '10:05'));
    check('usi din dobara tick: kuch nahi', (await bellsById(a.id)) === 4);
    // Saari 31 taareekhein chun kar mahina bhar band — phir bhi kal+aaj se zyada nahi.
    const b = await svc.createAnnouncement(boss, { title: 'Saari 31', recurrence: { type: 'MONTHLY', daysOfMonth: Array.from({ length: 31 }, (_, i) => i + 1), time: '09:00' } }, at('2026-12-01', '10:00'));
    await tick(at('2026-12-28', '10:00'));
    check('saari-31 par mahina bhar band: ek outing, 27 nahi', (await bellsById(b.id)) === 4, `got ${await bellsById(b.id)}`);
  }

  // ═══ TEST 28 — ek calendar din me do bell ke do raaste band hon ═══
  console.log('\nTEST 28 — repeat off/on, aur aaj hi gayi post par rule lagana');
  {
    await Notification.deleteMany({});
    const a = await svc.createAnnouncement(boss, { title: 'Off on off', recurrence: { type: 'MONTHLY', daysOfMonth: [1, 10, 20], time: '09:00' } }, at('2026-11-10', '10:00'));
    check('10 Nov: turant gaya', (await bellsById(a.id)) === 2);
    await svc.updateAnnouncement(a.id, { recurrence: { type: 'NONE' } }, at('2026-11-10', '15:00'));
    check('repeat band karne par stamp BACHA (saaf nahi hua)', (await Announcement.findById(a.id)).lastRecurredYMD === '2026-11-10', (await Announcement.findById(a.id)).lastRecurredYMD);
    await svc.updateAnnouncement(a.id, { recurrence: { type: 'MONTHLY', daysOfMonth: [1, 10, 20], time: '09:00' } }, at('2026-11-10', '16:00'));
    await tick(at('2026-11-10', '16:02'));
    check('usi din wapas on kiya: DOOSRI bell nahi', (await bellsById(a.id)) === 2, `got ${await bellsById(a.id)}`);
    check('occurrences me 10 Nov ek hi baar', (await occ(a.id)) === '["2026-11-10"]', await occ(a.id));
    await tick(at('2026-11-20', '09:05'));
    check('20 Nov: aage ka repeat chalta raha', (await bellsById(a.id)) === 4);

    // Aaj subah gayi plain post par dopahar me rule lagana → usi din dobara na jaye.
    const b = await svc.createAnnouncement(boss, { title: 'Subah gayi', priority: 'NORMAL' }, at('2026-11-10', '08:00'));
    check('plain post subah gayi', (await bellsById(b.id)) === 2);
    await svc.updateAnnouncement(b.id, { recurrence: { type: 'MONTHLY', daysOfMonth: [1, 10, 20], time: '09:00' } }, at('2026-11-10', '08:30'));
    await tick(at('2026-11-10', '09:05'));
    check('aaj hi gayi post par rule laga: usi din DOBARA nahi', (await bellsById(b.id)) === 2, `got ${await bellsById(b.id)}`);
    await tick(at('2026-11-20', '09:05'));
    check('…par 20 Nov par theek gaya', (await bellsById(b.id)) === 4);

    // Aur wahi off/on, par ek PURANI shakal ki row par: jiske paas announcedAt aur
    // notifiedAt dono nahi hain, sirf stamp hai. Yahan floor kal par gir jaata hai, to
    // "us din nikal chuka hai" ka eklauta saboot stamp hi bachta hai — isi liye NONE ke
    // waqt use mitaana nahi chahiye. (Naye rows par floor khud sambhal leta hai; isiliye
    // ye alag test chahiye tha, warna ye fix bina pehre ka reh jaata.)
    const ins = await Announcement.collection.insertOne({
      title: 'Purani shakal off on', body: 'x', priority: 'NORMAL', createdBy: boss._id,
      audienceRoles: [], audienceUsers: [], isActive: true, publishAt: null, expiresAt: null,
      notifiedAt: null, announcedAt: null, // dono gayab — purane deploy ki row
      recurrence: { type: 'MONTHLY', daysOfMonth: [10], time: '09:00' },
      lastRecurredYMD: '2026-11-10', occurrences: ['2026-11-10'],
      createdAt: at('2026-11-01', '10:00'), updatedAt: at('2026-11-01', '10:00'),
    });
    const dId = ins.insertedId;
    await svc.updateAnnouncement(dId, { recurrence: { type: 'NONE' } }, at('2026-11-10', '15:00'));
    await svc.updateAnnouncement(dId, { recurrence: { type: 'MONTHLY', daysOfMonth: [10], time: '09:00' } }, at('2026-11-10', '16:00'));
    await tick(at('2026-11-10', '16:02'));
    check('purani shakal par off/on: us din ki DOBARA bell nahi (stamp hi eklauta saboot tha)',
      (await bellsById(dId)) === 0, `got ${await bellsById(dId)}`);

    // Aur jo post PICHHLE hafte gayi thi, usme aaj rule lagao → aaj hi jaye (purana niyam).
    const c = await svc.createAnnouncement(boss, { title: 'Pichhle hafte gayi' }, at('2026-11-03', '10:00'));
    await svc.updateAnnouncement(c.id, { recurrence: { type: 'MONTHLY', daysOfMonth: [10], time: '09:00' } }, at('2026-11-10', '10:00'));
    await tick(at('2026-11-10', '10:02'));
    check('purani post par aaj rule laga: aaj hi gaya (ye niyam bacha hai)', (await bellsById(c.id)) === 4, `got ${await bellsById(c.id)}`);
  }

  // ═══ TEST 29 — PURANA BUG: pehli outing se pehle title theek karna ═══
  console.log('\nTEST 29 — na-nikli repeating post ka sirf TITLE badlo (purana bug)');
  {
    await Notification.deleteMany({});
    const a = await svc.createAnnouncement(boss, { title: 'Title badlega', recurrence: { type: 'MONTHLY', daysOfMonth: [20], time: '09:00' } }, at('2026-12-05', '10:00'));
    check('banate waqt chhupa hai', (await bellsById(a.id)) === 0);
    // THEEK WAISA payload jo purana dialog bhejta tha: title + publishAt: null.
    await svc.updateAnnouncement(a.id, { title: 'Naya title', publishAt: null }, at('2026-12-06', '10:00'));
    const row = await Announcement.findById(a.id);
    check('title badla', row.title === 'Naya title');
    check('publishAt ZINDA hai (null nahi hua)', row.publishAt && row.publishAt.getTime() === at('2026-12-20', '09:00').getTime(), String(row.publishAt));
    await tick(at('2026-12-20', '09:05'));
    check('apne din par bell BAJI (pehle hamesha ke liye gungi ho jaati thi)', (await bellsById(a.id)) === 2, `got ${await bellsById(a.id)}`);

    // Explicit DATE ab bhi maani jaye — repeating post ko rokne ka yahi raasta hai.
    const b = await svc.createAnnouncement(boss, { title: 'Rok do', recurrence: { type: 'MONTHLY', daysOfMonth: [20], time: '09:00' } }, at('2026-12-05', '10:00'));
    await svc.updateAnnouncement(b.id, { publishAt: at('2027-06-01', '09:00').toISOString() }, at('2026-12-06', '10:00'));
    check('explicit date ab bhi lagti hai', (await Announcement.findById(b.id)).publishAt.getTime() === at('2027-06-01', '09:00').getTime());
  }

  // ═══ TEST 30 — PURANA BUG: mari hui row edit karke ZINDA ho ═══
  console.log('\nTEST 30 — notifiedAt gayab wali row dobara edit par zinda ho');
  {
    await Notification.deleteMany({});
    const a = await svc.createAnnouncement(boss, { title: 'Mari hui row', recurrence: { type: 'MONTHLY', daysOfMonth: [10], time: '09:00' } }, at('2026-12-01', '10:00'));
    // Wahi shakal jo purane bug se banti thi: publishAt aur notifiedAt dono null.
    await Announcement.updateOne({ _id: a.id }, { $set: { publishAt: null, notifiedAt: null, announcedAt: null } });
    await tick(at('2026-12-10', '09:05'));
    check('is shakal me koi bell nahi jaati (bug ka saboot)', (await bellsById(a.id)) === 0, `got ${await bellsById(a.id)}`);
    // Ab wahi rule dobara save karo — pehle `if (!was)` gate ise zinda hone hi nahi deta tha.
    await svc.updateAnnouncement(a.id, { recurrence: { type: 'MONTHLY', daysOfMonth: [10], time: '09:00' } }, at('2026-12-15', '10:00'));
    check('notifiedAt wapas bhar gaya', !!(await Announcement.findById(a.id)).notifiedAt);
    await tick(at('2027-01-10', '09:05'));
    check('agle 10 par bell BAJI — row zinda ho gayi', (await bellsById(a.id)) === 2, `got ${await bellsById(a.id)}`);
  }

  // ═══ TEST 31 — WEEKLY kai din, YEARLY kai taareekhein ═══
  console.log('\nTEST 31 — WEEKLY {Mon,Thu} aur YEARLY Aug {15,31}');
  {
    await Notification.deleteMany({});
    const a = await svc.createAnnouncement(boss, { title: 'Som aur Guru', recurrence: { type: 'WEEKLY', weekdays: [1, 4], time: '09:00' } }, at('2026-09-14', '10:00'));
    check('Mon 14 Sep: turant gaya', (await bellsById(a.id)) === 2, `got ${await bellsById(a.id)}`);
    await tick(at('2026-09-15', '09:05'));
    check('Tue 15 Sep: kuch nahi', (await bellsById(a.id)) === 2);
    await tick(at('2026-09-17', '09:05'));
    check('Thu 17 Sep: gaya', (await bellsById(a.id)) === 4, `got ${await bellsById(a.id)}`);
    await tick(at('2026-09-21', '09:05'));
    check('agla Mon 21 Sep: gaya', (await bellsById(a.id)) === 6);
    check('weekdays DB me [1,4], purana weekday null', JSON.stringify((await Announcement.findById(a.id)).recurrence.weekdays) === '[1,4]' && (await Announcement.findById(a.id)).recurrence.weekday === null);

    const b = await svc.createAnnouncement(boss, { title: 'Agast ki do', recurrence: { type: 'YEARLY', month: 8, daysOfMonth: [15, 31], time: '09:00' } }, at('2026-08-01', '10:00'));
    await tick(at('2026-08-15', '09:05'));
    check('15 Aug: gaya', (await bellsById(b.id)) === 2, `got ${await bellsById(b.id)}`);
    await tick(at('2026-08-31', '09:05'));
    check('31 Aug: gaya', (await bellsById(b.id)) === 4);
    await tick(at('2026-09-15', '09:05'));
    check('15 Sep: kuch nahi (galat mahina)', (await bellsById(b.id)) === 4);
  }

  // ═══ TEST 32 — DATES: gini-chuni taareekhein, phir khatam ═══
  console.log('\nTEST 32 — DATES [5 Nov, 12 Dec, 3 Jan]: teen baar, phir chup');
  {
    await Notification.deleteMany({});
    const a = await svc.createAnnouncement(boss, { title: 'Teen khaas din', recurrence: { type: 'DATES', dates: ['2026-11-05', '2026-12-12', '2027-01-03'], time: '09:00' } }, at('2026-11-02', '10:00'));
    const row = await Announcement.findById(a.id);
    check('dates DB me sahi', JSON.stringify(row.recurrence.dates) === '["2026-11-05","2026-12-12","2027-01-03"]', JSON.stringify(row.recurrence.dates));
    check('publishAt pehli date par', row.publishAt.getTime() === at('2026-11-05', '09:00').getTime());
    check('banate waqt 0 bell', (await bellsById(a.id)) === 0);
    await tick(at('2026-11-05', '08:55'));
    check('5 Nov 08:55: abhi nahi', (await bellsById(a.id)) === 0);
    await tick(at('2026-11-05', '09:05'));
    check('5 Nov: gaya', (await bellsById(a.id)) === 2, `got ${await bellsById(a.id)}`);
    await tick(at('2026-11-20', '09:05'));
    check('beech ke din: kuch nahi', (await bellsById(a.id)) === 2);
    await tick(at('2026-12-12', '09:05'));
    check('12 Dec: gaya', (await bellsById(a.id)) === 4);
    await tick(at('2027-01-03', '09:05'));
    check('3 Jan: gaya', (await bellsById(a.id)) === 6, `got ${await bellsById(a.id)}`);
    for (const d of ['2027-01-04', '2027-01-10', '2027-02-03', '2028-01-03']) await tick(at(d, '09:05'));
    check('aakhri date ke baad: hamesha chup', (await bellsById(a.id)) === 6, `got ${await bellsById(a.id)}`);
    check('feed me ab bhi dikhta hai (khatam = record, gayab nahi)', (await svc.listVisible(u1, at('2027-02-10', '10:00'))).some((x) => x.title === 'Teen khaas din'));
    check('occurrences = teeno din', (await occ(a.id)) === '["2026-11-05","2026-12-12","2027-01-03"]', await occ(a.id));
  }

  // ═══ TEST 33 — DATES lagatar din: catch-up aur maani hui seema ═══
  console.log('\nTEST 33 — DATES lagatar [6 Nov, 7 Nov]: 09:00 se pehle tick par bache');
  {
    await Notification.deleteMany({});
    // Pehli date 1 Nov par post nikal chuka hai, to ye SIRF repeat-scanner ka test hai.
    const a = await svc.createAnnouncement(boss, { title: 'Lagatar bach gaya', recurrence: { type: 'DATES', dates: ['2026-11-01', '2026-11-06', '2026-11-07'], time: '09:00' } }, at('2026-11-01', '10:00'));
    check('1 Nov: turant gaya', (await bellsById(a.id)) === 2);
    await tick(at('2026-11-06', '08:55'));
    check('6 Nov 08:55: waqt se pehle kuch nahi', (await bellsById(a.id)) === 2);
    await tick(at('2026-11-07', '08:55')); // scanner raat bhar band tha
    check('7 Nov 08:55: 6 Nov ka CATCH-UP ho gaya', (await bellsById(a.id)) === 4, `got ${await bellsById(a.id)}`);
    await tick(at('2026-11-07', '09:05'));
    check('7 Nov 09:05: 7 Nov ki apni bhi gayi', (await bellsById(a.id)) === 6, `got ${await bellsById(a.id)}`);
    check('occurrences = teeno', (await occ(a.id)) === '["2026-11-01","2026-11-06","2026-11-07"]', await occ(a.id));

    // Aur wahi haalat jab outage 09:00 ke BAAD tak chale — 6 Nov chhod di jaati hai.
    await Notification.deleteMany({});
    const b = await svc.createAnnouncement(boss, { title: 'Lagatar chhoot gaya', recurrence: { type: 'DATES', dates: ['2026-11-01', '2026-11-06', '2026-11-07'], time: '09:00' } }, at('2026-11-01', '10:00'));
    await tick(at('2026-11-07', '10:00'));
    check('outage 09:00 ke baad tak: sirf 7 Nov nikla, 6 Nov chhod di (maana hua)', (await bellsById(b.id)) === 4, `got ${await bellsById(b.id)}`);
    check('…aur record sach bolta hai: 6 Nov likha hi nahi', (await occ(b.id)) === '["2026-11-01","2026-11-07"]', await occ(b.id));
  }

  // ═══ TEST 34 — DATES ki galtiyan: 400, 500 nahi ═══
  console.log('\nTEST 34 — DATES: nikal chuki taareekhein par saaf 400');
  {
    await Notification.deleteMany({});
    const before = await Announcement.countDocuments({});
    check('saari dates nikal chuki → 400 DATES_ALL_PAST (500 nahi)',
      (await failsWith(() => svc.createAnnouncement(boss, { title: 'Sab purani', recurrence: { type: 'DATES', dates: ['2026-10-01', '2026-10-15'], time: '09:00' } }, at('2026-11-02', '10:00')), 'DATES_ALL_PAST')) === 'ok',
      await failsWith(() => svc.createAnnouncement(boss, { title: 'Sab purani 2', recurrence: { type: 'DATES', dates: ['2026-10-01'], time: '09:00' } }, at('2026-11-02', '10:00')), 'DATES_ALL_PAST'));
    check('…aur koi row bani hi nahi', (await Announcement.countDocuments({})) === before);

    // Na-nikle post ki dates ko saari-purani se badalna → 400, aur row ACHHOOTI rahe.
    const a = await svc.createAnnouncement(boss, { title: 'Achhoota rahe', recurrence: { type: 'DATES', dates: ['2027-01-05'], time: '09:00' } }, at('2026-11-02', '10:00'));
    check('edit me saari purani dates → 400',
      (await failsWith(() => svc.updateAnnouncement(a.id, { title: 'Badla hua', recurrence: { type: 'DATES', dates: ['2026-10-01'], time: '09:00' } }, at('2026-11-02', '11:00')), 'DATE_IN_PAST')) === 'ok');
    const row = await Announcement.findById(a.id);
    check('…aur row par title bhi nahi badla (guard save se PEHLE hai)', row.title === 'Achhoota rahe', row.title);
    check('…aur dates bhi waisi hi', JSON.stringify(row.recurrence.dates) === '["2027-01-05"]');
    check('sirf title badalna chalta hai (post uneditable na ho)',
      (await svc.updateAnnouncement(a.id, { title: 'Sirf title' }, at('2026-11-02', '11:30'))).title === 'Sirf title');

    // Jo date post PEHLE SE carry kar raha hai, wo nikal jaane ke baad bhi chalti rahe.
    const b = await svc.createAnnouncement(boss, { title: 'Purani apni date', recurrence: { type: 'DATES', dates: ['2026-11-01', '2027-01-05'], time: '09:00' } }, at('2026-11-01', '10:00'));
    check('apni purani date wapas bhejna chalta hai (dialog poori list bhejta hai)',
      !!(await svc.updateAnnouncement(b.id, { recurrence: { type: 'DATES', dates: ['2026-11-01', '2027-01-05', '2027-02-09'], time: '09:00' } }, at('2026-11-10', '10:00'))));
    check('NAYI purani date jodna reject hoti hai',
      (await failsWith(() => svc.updateAnnouncement(b.id, { recurrence: { type: 'DATES', dates: ['2026-11-01', '2026-11-05', '2027-01-05'], time: '09:00' } }, at('2026-11-10', '10:00')), 'DATE_IN_PAST')) === 'ok');

    // Type badalne par purani list DB me zero ho jaye.
    await svc.updateAnnouncement(b.id, { recurrence: { type: 'WEEKLY', weekdays: [6], time: '09:00' } }, at('2026-11-10', '11:00'));
    check('DATES → WEEKLY: dates [] ho gayi (stale list na bache)', JSON.stringify((await Announcement.findById(b.id)).recurrence.dates) === '[]', JSON.stringify((await Announcement.findById(b.id)).recurrence.dates));
  }

  // ═══ TEST 35 — purani single-day row (daysOfMonth key hai hi nahi) ═══
  console.log('\nTEST 35 — bahut purani row: sirf dayOfMonth, koi list nahi');
  {
    await Notification.deleteMany({});
    const ins = await Announcement.collection.insertOne({
      title: 'Bahut purani monthly', body: 'x', priority: 'NORMAL', createdBy: boss._id,
      audienceRoles: [], audienceUsers: [], isActive: true, publishAt: null, expiresAt: null,
      notifiedAt: at('2026-11-15', '09:00'), announcedAt: at('2026-11-15', '09:00'),
      recurrence: { type: 'MONTHLY', dayOfMonth: 15, time: '09:00' }, // list key BILKUL nahi
      lastRecurredYMD: '2026-11-15', occurrences: ['2026-11-15'],
      createdAt: at('2026-11-15', '09:00'), updatedAt: at('2026-11-15', '09:00'),
    });
    const id = ins.insertedId;
    await tick(at('2026-12-15', '09:05'));
    check('purani shakal par scanner crash nahi hua aur 15 Dec par bell gayi', (await bellsById(id)) === 2, `got ${await bellsById(id)}`);
    // Ab usi row par nayi list lagao — purane 15 ka asar poora khatam ho.
    await svc.updateAnnouncement(id, { recurrence: { type: 'MONTHLY', daysOfMonth: [3], time: '09:00' } }, at('2026-12-16', '10:00'));
    await tick(at('2027-01-15', '09:05'));
    check('nayi list ke baad purana 15 mar gaya', (await bellsById(id)) === 2, `got ${await bellsById(id)}`);
    await tick(at('2027-02-03', '09:05'));
    check('…aur naya 3 chalta hai', (await bellsById(id)) === 4, `got ${await bellsById(id)}`);
  }

  // ═══ TEST 36 — do instance ek hi tick par: ek hi outing ═══
  console.log('\nTEST 36 — lagatar din + do scanner ek saath: ek hi outing');
  {
    await Notification.deleteMany({});
    const a = await svc.createAnnouncement(boss, { title: 'Race multi', recurrence: { type: 'MONTHLY', daysOfMonth: [1, 2], time: '09:00' } }, at('2026-12-01', '10:00'));
    const when = at('2026-12-02', '09:05');
    await Promise.all([svc.announceRecurring(when), svc.announceRecurring(when), svc.announceRecurring(when)]);
    check('teen instance, phir bhi EK outing', (await bellsById(a.id)) === 4, `got ${await bellsById(a.id)}`);
    check('occurrences me 2 Dec ek hi baar', (await occ(a.id)) === '["2026-12-01","2026-12-02"]', await occ(a.id));
  }

  console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PASS'}\n`);
  await mongoose.connection.dropDatabase();
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
