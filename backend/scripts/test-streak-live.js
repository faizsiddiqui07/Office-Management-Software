/**
 * Punctual streak ab LIVE dikhti hai — iska test.
 *
 * KYA SAABIT KARTA HAI.
 *  1. `judgeStreakDay` (lib/streakDay.js) har haalat ka wahi jawab deta hai jo niyam hai —
 *     aur half-day wala naya niyam SIRF floor (1 Oct 2026) ke baad lagta hai, usse pehle
 *     ke din waise ke waise rehte hain.
 *  2. `liveStreakFor` aaj ke din ko sahi padhta hai: time par aaye → ginti +1, late →
 *     turant 0, abhi tak koi record nahi → kuch na badle (PENDING), chhutti/WFH/off-day →
 *     neutral, aur chhatha din aaj poora ho to "completedToday".
 *  3. SABSE ZAROORI: live overlay kuch LIKHTA nahi. Overlay chalne ke baad bhi
 *     `streakRuns`, `lastStreakScan` aur `auto_streak` ki ginti bilkul waisi hi rehti hai
 *     — yaani award raat ke scan ka hi kaam hai, jaisa owner ne kaha.
 *
 * Prod par chalane se INKAAR karta hai — DB ke naam me "test" hona zaroori hai.
 *
 *   node scripts/_clone-to-test-db.js --to office_test_streaklive
 *   MONGODB_DB=office_test_streaklive node scripts/test-streak-live.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Attendance } from '../src/models/Attendance.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { liveStreakFor, runRollingStreak } from '../src/services/bonus.service.js';
import { checkIn } from '../src/services/attendance.service.js';
import {
  judgeStreakDay, HALF_DAY_LATE_BREAKS_YMD, STREAK_LEN,
  STREAK_BREAK, STREAK_NEUTRAL, STREAK_ON_TIME, STREAK_PENDING,
} from '../src/lib/streakDay.js';
import { can } from '../src/lib/permissions.js';
import { ymdInTz, companyDayFromYMD, companyDayInstantAt, companyTzMidnight } from '../src/lib/time.js';

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); } else { fail += 1; console.log(`  ❌ ${label}${extra ? `  — ${extra}` : ''}`); }
};

await connectDB();
const dbName = mongoose.connection.db.databaseName;
if (!/test/i.test(dbName)) {
  console.error(`\n⛔ "${dbName}" par nahi chalunga — naam me "test" hona chahiye.\n   MONGODB_DB=office_test_streaklive node scripts/test-streak-live.js\n`);
  process.exit(1);
}
console.log(`\n🧪 DB: ${dbName}\n`);

// ── 1. Niyam ki poori truth table (koi DB nahi, sirf function) ───────────────────────
console.log('1) judgeStreakDay — har haalat');
const dayUser = { dateOfBirth: '1996-03-14' };
const MON = '2026-10-12'; // Monday, koi holiday nahi
const J = (record, extra = {}) => judgeStreakDay(dayUser, MON, { record, offDays: [0], ...extra });

ok(J({ status: 'PRESENT' }) === STREAK_ON_TIME, 'PRESENT → on-time');
ok(J({ status: 'LATE' }) === STREAK_BREAK, 'LATE → break');
ok(J({ status: 'LATE', excused: true }) === STREAK_ON_TIME, 'LATE par excused (on-duty) → on-time');
ok(J({ status: 'WFH' }) === STREAK_NEUTRAL, 'WFH → neutral');
ok(J({ status: 'ON_LEAVE' }) === STREAK_NEUTRAL, 'ON_LEAVE → neutral');
ok(J(null) === STREAK_BREAK, 'khatam hue din par koi record nahi → break (gair-hazri)');
ok(J(null, { onLeave: true }) === STREAK_NEUTRAL, 'approved leave wala din, koi record nahi → neutral');
ok(J(null, { isHoliday: true }) === STREAK_NEUTRAL, 'company holiday → neutral');
ok(judgeStreakDay(dayUser, '2026-10-11', { record: null, offDays: [0] }) === STREAK_NEUTRAL, 'Sunday (uska off-day) → neutral');
ok(judgeStreakDay(dayUser, '2026-03-14', { record: null, offDays: [0] }) === STREAK_NEUTRAL, 'uska janamdin → neutral');
ok(J(null, { live: true }) === STREAK_PENDING, 'AAJ, abhi koi record nahi → PENDING (toota nahi)');
ok(J({ status: 'LATE' }, { live: true }) === STREAK_BREAK, 'AAJ late lag gayi → turant break');
ok(J({ status: 'PRESENT' }, { live: true }) === STREAK_ON_TIME, 'AAJ time par → turant +1');

console.log('\n   half-day ka naya niyam, floor =', HALF_DAY_LATE_BREAKS_YMD);
const halfLate = { status: 'LATE', halfDayLeave: true, halfDayPart: 'FIRST' };
const before = '2026-09-30';
ok(judgeStreakDay(dayUser, before, { record: halfLate, offDays: [0] }) === STREAK_ON_TIME,
  `${before} (floor se pehle) → half-day ki late maaf, on-time hi gini jati hai`);
ok(judgeStreakDay(dayUser, '2026-10-01', { record: halfLate, offDays: [0] }) === STREAK_BREAK,
  '2026-10-01 (floor par) → half-day ki late ab streak todti hai');
ok(judgeStreakDay(dayUser, MON, { record: { ...halfLate, halfDayPart: 'SECOND' }, offDays: [0] }) === STREAK_BREAK,
  'doosri half (subah kaam) ki late bhi todti hai');
ok(judgeStreakDay(dayUser, MON, { record: { ...halfLate, excused: true }, offDays: [0] }) === STREAK_ON_TIME,
  'half-day ki late agar excused hai → nahi todti');
ok(judgeStreakDay(dayUser, MON, { record: { status: 'PRESENT', halfDayLeave: true }, offDays: [0] }) === STREAK_ON_TIME,
  'half-day par time par aaye → on-time (pehle jaisa)');

// ── 2. Ek asli user, aaj ka din ──────────────────────────────────────────────────────
console.log('\n2) liveStreakFor — aaj ka din');
const settings = await Setting.getSingleton();
const today = ymdInTz(new Date());
const day = companyTzMidnight(new Date());

// Aisa banda chuno jiska aaj off-day na ho: Sunday/holiday par test bemani ho jata.
const roster = (await User.find({ isActive: true }).select('name role schedule dateOfBirth dateOfJoining'))
  .filter((u) => can({ role: u.role }, 'markAttendance'));
const subject = roster.find((u) => (u.dateOfBirth || '').slice(5, 10) !== today.slice(5, 10)) || roster[0];
ok(!!subject, `test ke liye banda: ${subject?.name}`);

const stored = () => Setting.findOne({ key: 'global' }).select('bonus.streakRuns bonus.lastStreakScan').lean();
const setCounter = async (n) => {
  await Setting.updateOne({ key: 'global' }, { $set: { [`bonus.streakRuns.${String(subject._id)}`]: n } });
  Setting.invalidateCache();
};
const setToday = async (patch) => {
  await Attendance.deleteOne({ user: subject._id, date: day });
  if (patch) await Attendance.create({ user: subject._id, date: day, ...patch });
  Setting.invalidateCache();
};
const live = async () => liveStreakFor(subject, await Setting.getSingleton());

const s0 = await stored();
const watermark = s0?.bonus?.lastStreakScan || '';
ok(watermark && watermark < today, `watermark kal ya usse pehle ka hai (${watermark})`);

await setCounter(3);
await setToday(null);
let r = await live();
ok(r.count === 3 && r.today === STREAK_PENDING, 'abhi koi check-in nahi → ginti wahi 3, PENDING', JSON.stringify(r));

await setToday({ status: 'PRESENT', checkInAt: companyDayInstantAt(day, '10:05') });
r = await live();
ok(r.count === 4 && r.today === STREAK_ON_TIME, 'time par check-in → 3 se 4', JSON.stringify(r));

await setToday({ status: 'LATE', checkInAt: companyDayInstantAt(day, '10:40') });
r = await live();
ok(r.count === 0 && r.today === STREAK_BREAK, 'late check-in → turant 0', JSON.stringify(r));

await setToday({ status: 'LATE', excused: true, checkInAt: companyDayInstantAt(day, '10:40') });
r = await live();
ok(r.count === 4 && r.today === STREAK_ON_TIME, 'late par on-duty (excused) → 4 hi rehti hai', JSON.stringify(r));

await setToday({ status: 'LATE', halfDayLeave: true, halfDayPart: 'SECOND', checkInAt: companyDayInstantAt(day, '11:30') });
r = await live();
ok(r.count === 0 && r.today === STREAK_BREAK, 'half-day (subah kaam) par late → ab todti hai', JSON.stringify(r));

await setToday({ status: 'ON_LEAVE', halfDayLeave: false });
r = await live();
ok(r.count === 3 && r.today === STREAK_NEUTRAL, 'poore din ki chhutti → neutral, 3 par ruki', JSON.stringify(r));

await setToday({ status: 'WFH' });
r = await live();
ok(r.count === 3 && r.today === STREAK_NEUTRAL, 'WFH → neutral', JSON.stringify(r));

// ── 3. Chhatha din aaj ───────────────────────────────────────────────────────────────
console.log('\n3) Chhatha din aaj poora hua');
await setCounter(STREAK_LEN - 1);
await setToday({ status: 'PRESENT', checkInAt: companyDayInstantAt(day, '09:58') });
r = await live();
ok(r.count === STREAK_LEN && r.completedToday === true, `${STREAK_LEN} of ${STREAK_LEN} dikhta hai, completedToday`, JSON.stringify(r));

// ── 4. Overlay kuch likhta nahi ──────────────────────────────────────────────────────
console.log('\n4) Overlay sirf padhta hai (sabse zaroori)');
const awardsBefore = await PointEntry.countDocuments({ source: 'auto_streak' });
const beforeState = await stored();
for (let i = 0; i < 3; i += 1) await live(); // baar-baar padho
const afterState = await stored();
ok(await PointEntry.countDocuments({ source: 'auto_streak' }) === awardsBefore,
  'teen baar padhne par bhi ek bhi naya award nahi bana', `${awardsBefore}`);
ok((afterState?.bonus?.lastStreakScan || '') === (beforeState?.bonus?.lastStreakScan || ''),
  'watermark nahi hila');
ok(Number(afterState?.bonus?.streakRuns?.[String(subject._id)]) === Number(beforeState?.bonus?.streakRuns?.[String(subject._id)]),
  'counter nahi hila');

// ── 5. Raat ka scan abhi bhi aaj ko nahi chhuta ──────────────────────────────────────
console.log('\n5) runRollingStreak aaj ke din ko nahi ginta');
const b = (await Setting.getSingleton()).bonus || {};
await runRollingStreak(b, { ignoreLock: true });
const afterScan = await stored();
ok((afterScan?.bonus?.lastStreakScan || '') < today, `watermark ab bhi aaj se pehle ka hai (${afterScan?.bonus?.lastStreakScan})`);
ok(Number(afterScan?.bonus?.streakRuns?.[String(subject._id)]) === STREAK_LEN - 1,
  'scan ne aaj ke PRESENT ko nahi gina — counter wahi 5', JSON.stringify(afterScan?.bonus?.streakRuns?.[String(subject._id)]));

await setToday(null);

// ── 6. Asli check-in raasta: subah wala half ab late ho sakta hai ────────────────────
// Yahan status likha jata hai — pure function nahi, poora raasta.
console.log('\n6) Asli check-in: half-day (subah kaam) par late');
{
  const gps = (await Setting.getSingleton()).gpsAttendance || {};
  // verifyGeofence lat/lng naam padhta hai (latitude/longitude nahi) — office ke theek
  // upar khade ho kar check-in, taaki 50 m ka ghera na roke.
  const coords = gps.enabled ? { lat: gps.latitude, lng: gps.longitude } : null;
  const nowHM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const lateKey = `auto_late:${subject._id}:${today}`;
  await setCounter(3);
  // Jaisa leave approve hone par banta hai: aaj ka din SECOND-half (dopahar chhutti).
  await setToday({ status: 'ON_LEAVE', halfDayLeave: true, halfDayPart: 'SECOND' });
  await PointEntry.deleteMany({ dedupeKey: lateKey });
  if (nowHM > '11:05') {
    const r = await checkIn(subject, {}, coords);
    const row = await PointEntry.findOne({ dedupeKey: lateKey }).lean();
    ok(r.status === 'LATE', `abhi ${nowHM} par check-in → LATE (pehle PRESENT hota tha)`, r.status);
    ok(!!row && row.points <= -1, 'late ki penalty row ban gayi', String(row?.points));
    const after = await live();
    ok(after.count === 0 && after.today === STREAK_BREAK, 'aur usi waqt streak bhi toot gayi', JSON.stringify(after));
  } else {
    console.log(`  ⏭  abhi ${nowHM} baje hain (11:05 se pehle) — ye case aaj skip`);
  }
  await setToday(null);
  await PointEntry.deleteMany({ dedupeKey: lateKey });
}

console.log(`\n${fail ? '❌' : '✅'}  ${pass} pass, ${fail} fail\n`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
