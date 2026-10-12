/**
 * Off-day par poora din overtime — iska poora test. Asli data ki throwaway COPY par.
 *
 * Jo cheezein galat hone par paise bigadte hain, wahi yahan sabse pehle hain:
 *   1. Aam din ka hisaab bilkul nahi badla
 *   2. Off-day par poora span overtime (check-in se check-out tak)
 *   3. FLOOR — 1 Oct 2026 se PEHLE ka off-day purane niyam par hi rehta hai
 *   4. Faisla ROW ke nishaan se aata hai, aaj ke calendar se nahi
 *   5. Settings badalne par guzra hua mahina nahi hilta
 *   6. Points minute ke saath chalte hain, aur dobara chalane par dugne nahi hote
 *   7. "Recalculate points" ab overtime bhi theek karta hai (pehle chhuta tak nahi tha)
 *
 * Prod par chalne se INKAAR karta hai — DB ke naam me "test" hona zaroori hai.
 *
 *   node scripts/_clone-to-test-db.js --to office_test_ot
 *   MONGODB_DB=office_test_ot node scripts/test-offday-overtime.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Attendance } from '../src/models/Attendance.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { companyDayFromYMD, companyDayInstantAt, computeWork, ymdInTz, OFFDAY_FULL_OT_FLOOR_YMD } from '../src/lib/time.js';
import { isOffDaySync } from '../src/lib/offDay.js';
import { effectiveSchedule } from '../src/lib/schedule.js';
import { recomputeAllOvertime } from '../src/services/attendance.service.js';
import { recomputeUserMonthOvertime } from '../src/services/bonus.service.js';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${extra ? `  — ${extra}` : ''}`); }
};
const at = (ymd, hm) => companyDayInstantAt(companyDayFromYMD(ymd), hm);

// ── 1. computeWork khud — bina DB ke, isliye yahi sabse pakka hissa hai ──────────────
console.log('\n1) computeWork ka hisaab (koi DB nahi)');
{
  const day = companyDayFromYMD('2026-10-11'); // Sunday, floor ke baad
  const inA = at('2026-10-11', '12:30'); const outA = at('2026-10-11', '22:00');

  const normal = computeWork(inA, outA, day, '18:00', 0, false);
  ok(normal.workedMinutes === 570 && normal.overtimeMinutes === 240,
    'aam din: OT = shift end ke baad ka waqt', `${normal.workedMinutes}m worked / ${normal.overtimeMinutes}m OT`);

  const off = computeWork(inA, outA, day, '18:00', 0, true);
  ok(off.workedMinutes === 570 && off.overtimeMinutes === 570,
    'off-day: poora span OT, aur workedMinutes waisa hi', `${off.workedMinutes}m / ${off.overtimeMinutes}m`);

  const buffered = computeWork(inA, outA, day, '18:00', 60, true);
  ok(buffered.overtimeMinutes === 570, 'off-day par buffer ka koi asar nahi', `${buffered.overtimeMinutes}m`);

  // Jaldi nikalne wala — purane niyam se 0 milta tha
  const early = computeWork(at('2026-10-11', '12:30'), at('2026-10-11', '19:30'), day, '19:00', 0, true);
  ok(early.overtimeMinutes === 420, 'shift end se pehle nikla, phir bhi poora din OT', `${early.overtimeMinutes}m`);

  // Shaam wala case — naya niyam GHATA deta hai. Owner ka faisla: hamesha poora span.
  const evening = computeWork(at('2026-10-11', '20:00'), at('2026-10-11', '22:00'), day, '18:00', 0, true);
  ok(evening.overtimeMinutes === 120, 'shaam ko aaya: poora span (240 nahi, 120)', `${evening.overtimeMinutes}m`);
}

// ── 2. FLOOR — is poore kaam ki sabse zaroori baat ──────────────────────────────────
console.log(`\n2) Floor (${OFFDAY_FULL_OT_FLOOR_YMD}) — purane mahine chhute nahi`);
{
  const mk = (ymd) => computeWork(at(ymd, '12:30'), at(ymd, '22:00'), companyDayFromYMD(ymd), '18:00', 0, true);
  ok(mk('2026-09-27').overtimeMinutes === 240, 'floor se PEHLE ka Sunday: purana niyam (240)', `${mk('2026-09-27').overtimeMinutes}m`);
  ok(mk('2026-09-30').overtimeMinutes === 240, '30 Sep: purana niyam', `${mk('2026-09-30').overtimeMinutes}m`);
  ok(mk('2026-10-01').overtimeMinutes === 570, '1 Oct (floor ka din): naya niyam', `${mk('2026-10-01').overtimeMinutes}m`);
  ok(mk('2026-10-11').overtimeMinutes === 570, '11 Oct: naya niyam', `${mk('2026-10-11').overtimeMinutes}m`);
}

await connectDB();
const dbName = mongoose.connection.db.databaseName;
if (!/test/i.test(dbName)) {
  console.error(`\n⛔ "${dbName}" par nahi chalunga — naam me "test" hona chahiye.\n`);
  process.exit(1);
}
console.log(`\n🧪 DB: ${dbName}`);

const s = await Setting.getSingleton();
const SUN = '2026-10-11';
const u = await User.findOne({ name: /manish/i }).select('name _id schedule dateOfBirth');
const day = companyDayFromYMD(SUN);

// ── 3. isOffDaySync — wahi teen shart ───────────────────────────────────────────────
console.log('\n3) isOffDaySync');
{
  ok(isOffDaySync(u, SUN, s, new Set()) === true, 'Sunday → off day');
  ok(isOffDaySync(u, '2026-10-12', s, new Set()) === false, 'Monday → off day nahi');
  ok(isOffDaySync(u, '2026-10-12', s, new Set(['2026-10-12'])) === true, 'holiday set me ho → off day');
  const bd = { ...u.toObject(), schedule: u.schedule, dateOfBirth: '1990-10-12' };
  ok(isOffDaySync(bd, '2026-10-12', s, new Set()) === true, 'janamdin → off day (owner ka faisla)');
}

// ── 4. Nishaan padha jaata hai, calendar se dobara nahi poochha jaata ───────────────
console.log('\n4) Faisla ROW ke nishaan se');
{
  await Attendance.deleteOne({ user: u._id, date: day });
  await Attendance.create({
    user: u._id, date: day, status: 'PRESENT',
    checkInAt: at(SUN, '12:30'), checkOutAt: at(SUN, '22:00'),
    workedMinutes: 570, overtimeMinutes: 240, offDayWork: false,   // nishaan jaan-bujh kar FALSE
  });
  // Expected us bande ke ASLI schedule se nikaala jaa raha hai, hardcode nahi: is office me
  // overtimeAfterMinutes 60 hai, to purana hisaab 18:00 nahi 19:00 se shuru hota hai.
  const sched = effectiveSchedule(u, s);
  const oldWay = computeWork(at(SUN, '12:30'), at(SUN, '22:00'), day, sched.workEnd, sched.overtimeAfterMinutes, false).overtimeMinutes;
  await recomputeAllOvertime({ userId: u._id });
  let r = await Attendance.findOne({ user: u._id, date: day });
  ok(r.overtimeMinutes === oldWay, `nishaan false → purana hisaab (${oldWay}m), chahe din Sunday hi ho`, `${r.overtimeMinutes}m`);

  await Attendance.updateOne({ _id: r._id }, { $set: { offDayWork: true } });
  await recomputeAllOvertime({ userId: u._id });
  r = await Attendance.findOne({ user: u._id, date: day });
  ok(r.overtimeMinutes === 570, 'nishaan true → poora din', `${r.overtimeMinutes}m`);
}

// ── 5. Points minute ke saath, aur dobara chalane par dugne nahi ────────────────────
console.log('\n5) Points');
{
  await recomputeUserMonthOvertime(u._id, '2026-10');
  const a = await PointEntry.find({ user: u._id, source: 'auto_ot', month: '2026-10' });
  ok(a.length <= 1, 'us mahine ka sirf EK auto_ot row', `${a.length} rows`);
  const first = a[0]?.points ?? 0;
  await recomputeUserMonthOvertime(u._id, '2026-10');
  await recomputeUserMonthOvertime(u._id, '2026-10');
  const b = await PointEntry.find({ user: u._id, source: 'auto_ot', month: '2026-10' });
  ok(b.length <= 1 && (b[0]?.points ?? 0) === first, 'teen baar chalane par bhi wahi points (dugne nahi)', `${first} → ${b[0]?.points ?? 0}`);
}

// ── 6. Guzra hua mahina Settings badalne par nahi hilta ─────────────────────────────
console.log('\n6) Purana mahina surakshit');
{
  const SEP = '2026-09-27'; // floor se pehle ka Sunday
  const sepDay = companyDayFromYMD(SEP);
  await Attendance.deleteOne({ user: u._id, date: sepDay });
  await Attendance.create({
    user: u._id, date: sepDay, status: 'PRESENT',
    checkInAt: at(SEP, '12:30'), checkOutAt: at(SEP, '22:00'),
    workedMinutes: 570, overtimeMinutes: 240, offDayWork: true,   // nishaan laga hua bhi ho
  });
  const sc = effectiveSchedule(u, s);
  const expect = computeWork(at(SEP, '12:30'), at(SEP, '22:00'), sepDay, sc.workEnd, sc.overtimeAfterMinutes, false).overtimeMinutes;
  await recomputeAllOvertime();   // wahi jo Settings save par khud chalta hai
  const r = await Attendance.findOne({ user: u._id, date: sepDay });
  ok(r.overtimeMinutes === expect, `floor se pehle ka din: nishaan lage hone par bhi purana hisaab (${expect}m)`, `${r.overtimeMinutes}m`);
  await Attendance.deleteOne({ _id: r._id });
}

// ── 7. Sehat: kisi ko ek hi mahine ke do auto_ot row na milen ───────────────────────
console.log('\n7) Poore DB ki sehat');
{
  const dupes = await PointEntry.aggregate([
    { $match: { source: 'auto_ot' } },
    { $group: { _id: { u: '$user', m: '$month' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  ok(dupes.length === 0, 'kisi user-month me do auto_ot row nahi', `${dupes.length} duplicate`);
  const neg = await Attendance.countDocuments({ overtimeMinutes: { $lt: 0 } });
  ok(neg === 0, 'koi negative overtime nahi', `${neg}`);
  // Sirf FLOOR ke baad ke din. Usse pehle purane niyam ki ek jaayaz quirk hai: jo banda
  // OT threshold ke BAAD check-in karta tha (misaal 14 Aug 2026, Ankur 20:02–23:38) uska
  // OT uske worked se thoda zyada nikal aata tha. Naye niyam me ye ho hi nahi sakta,
  // kyunki off-day par OT = worked hota hai — par purane dinon par ye lagana galat hoga.
  const bad = await Attendance.countDocuments({
    date: { $gte: companyDayFromYMD(OFFDAY_FULL_OT_FLOOR_YMD) },
    $expr: { $gt: ['$overtimeMinutes', '$workedMinutes'] },
  });
  ok(bad === 0, `floor ke baad kisi din ka overtime uske worked se zyada nahi`, `${bad} rows`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} pass, ${fail} fail\n`);
await mongoose.disconnect();
process.exit(fail === 0 ? 0 : 1);
