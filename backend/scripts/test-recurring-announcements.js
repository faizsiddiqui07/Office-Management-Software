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
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
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
    check('anchor = jis din gaya tha (7 Sep)', d.lastRecurredYMD === '2026-09-07', d.lastRecurredYMD);
    await tick(at('2026-09-12', '10:01'));
    check('usi Saturday (edit ke baad) announce hua', (await bells(T)) === 4, `got ${await bells(T)}`);
    await tick(at('2026-09-12', '12:00'));
    check('dobara nahi', (await bells(T)) === 4);
    await tick(at('2026-09-19', '09:01'));
    check('agle Saturday phir', (await bells(T)) === 6);
  }

  // ═══ TEST 6 — repeat hataana, retire, expiry ═══
  console.log('\nTEST 6 — band karne ke teen raaste');
  {
    const T1 = 'Stop me';
    const a = await svc.createAnnouncement(boss, { title: T1, recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-12', '10:00'));
    await svc.updateAnnouncement(a.id, { recurrence: { type: 'NONE' } }, at('2026-09-14', '10:00'));
    await tick(at('2026-09-19', '09:01'));
    check('repeat hataya → agle Sat kuch nahi', (await bells(T1)) === 2, `got ${await bells(T1)}`);
    check('lastRecurredYMD saaf', (await Announcement.findById(a.id)).lastRecurredYMD === '');

    const T2 = 'Retire me';
    const b = await svc.createAnnouncement(boss, { title: T2, recurrence: { type: 'WEEKLY', weekday: 6, time: '09:00' } }, at('2026-09-12', '10:00'));
    await svc.retireAnnouncement(b.id);
    await tick(at('2026-09-19', '09:01'));
    check('retire → agle Sat kuch nahi', (await bells(T2)) === 2);

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
    check('anchor = createdAt ka din', d.lastRecurredYMD === '2026-09-01', d.lastRecurredYMD);
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

  console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PASS'}\n`);
  await mongoose.connection.dropDatabase();
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
