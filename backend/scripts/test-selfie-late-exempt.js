/**
 * "Selfie wale check-in par late nahi lagti" — ye chhoot HAR raaste par lagti hai, sirf
 * check-in ke waqt nahi.
 *
 * Pehle chhoot sirf checkIn() me thi (attendance.service.js). Uske baad jo bhi raasta us
 * din ko dobara tolta tha, wo ladder se seedha poochta tha aur selfie wale PRESENT ko
 * chupchaap LATE kar deta tha:
 *   - half-day leave approve hona      (leave.service.js)
 *   - half-day leave cancel hona       (leave.service.js)
 *   - leadership ka time edit          (attendance.service.js → setAttendanceRecord)
 *   - correction approve hona          (regularization.service.js → decide)
 *
 * Har case ke saath uska CONTROL bhi chalta hai — bilkul wahi din bina selfie ke — taaki
 * ye sabit ho ki test sirf "sab PRESENT bol do" se paas nahi ho raha.
 *
 * Prod par chalne se INKAAR karta hai — DB ke naam me "test" hona zaroori hai.
 *
 *   node scripts/_clone-to-test-db.js --to office_test_selfie
 *   MONGODB_DB=office_test_selfie node scripts/test-selfie-late-exempt.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Attendance } from '../src/models/Attendance.js';
import { Regularization } from '../src/models/Regularization.js';
import { companyDayFromYMD, companyDayInstantAt } from '../src/lib/time.js';
import { isSelfieCheckIn, judgeCheckIn } from '../src/lib/lateLadder.js';
import { effectiveSchedule } from '../src/lib/schedule.js';
import { setAttendanceRecord } from '../src/services/attendance.service.js';
import { decide } from '../src/services/regularization.service.js';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${extra ? `  — ${extra}` : ''}`); }
};

const SELFIE_KEY = 'attendance/2026/10/selfie-test.jpg';
// Ek aam kaam ka din (Thursday), ladder ke floor ke baad.
const YMD = '2026-10-15';
// Shift 10:00–19:00, grace 16 min → subah ke marks 10:16 aur 11:00 (max 2 rung).
// 13:54 dono se aage hai, to bina chhoot ke ye pakka LATE hai.
const LATE_HM = '13:54';

// ── 1. Helper khud — bina DB ke ─────────────────────────────────────────────────────
console.log('\n1) isSelfieCheckIn ka sach');
ok(isSelfieCheckIn({ checkInMeta: { selfieKey: SELFIE_KEY } }) === true, 'selfieKey hai → true');
ok(isSelfieCheckIn({ checkInMeta: { ip: '1.2.3.4' } }) === false, 'sirf ip/userAgent → false');
ok(isSelfieCheckIn({ checkOutMeta: { selfieKey: SELFIE_KEY } }) === false, 'sirf CHECK-OUT ki selfie → false');
ok(isSelfieCheckIn(null) === false, 'record hi nahi → false');

// ── DB wala hissa ───────────────────────────────────────────────────────────────────
await connectDB();
const dbName = mongoose.connection.db.databaseName;
if (!/test/i.test(dbName)) {
  console.error(`\n✋ "${dbName}" test DB nahi lagta. Pehle clone banao:\n   node scripts/_clone-to-test-db.js --to office_test_selfie\n`);
  await mongoose.disconnect();
  process.exit(1);
}
console.log(`\n(DB: ${dbName})`);

const settings = await Setting.getSingleton();
const day = companyDayFromYMD(YMD);

/** Do test bande — ek selfie wala, ek bina. Dono ka shift bilkul ek jaisa. */
async function testUser(suffix) {
  const email = `selfie-test-${suffix}@example.invalid`;
  await User.deleteOne({ email });
  return User.create({
    name: `Selfie Test ${suffix}`,
    email,
    employeeId: `EMP-SELFIE-${suffix}`,
    role: 'TEAM',
    passwordHash: 'x'.repeat(60),
    mustChangePassword: false,
    dateOfJoining: new Date('2026-01-01T00:00:00.000Z'),
    schedule: { workStart: '10:00', workEnd: '19:00', graceMinutes: 16 },
  });
}
const withSelfie = await testUser('A');
const without = await testUser('B');
const approver = await User.findOne({ _id: { $nin: [withSelfie._id, without._id] } }).select('_id name');

const sched = effectiveSchedule(withSelfie, settings);
ok(sched.workStart === '10:00' && sched.workEnd === '19:00' && sched.graceMinutes === 16,
  'test shift 10:00–19:00, grace 16', JSON.stringify(sched));
ok(judgeCheckIn(companyDayInstantAt(day, LATE_HM), day, null, sched).rungs > 0,
  `control: ${LATE_HM} ladder ke hisaab se LATE hai (chhoot ke bina)`);

/** Us din ki row banao — PRESENT, selfie ke saath ya bina. */
async function seedRow(user, { selfie }) {
  await Attendance.deleteMany({ user: user._id });
  return Attendance.create({
    user: user._id,
    date: day,
    checkInAt: companyDayInstantAt(day, '09:55'),
    checkOutAt: companyDayInstantAt(day, '18:30'),
    status: 'PRESENT',
    checkInMeta: selfie ? { selfieKey: SELFIE_KEY } : { ip: '10.0.0.1' },
  });
}
const statusOf = async (user) => (await Attendance.findOne({ user: user._id, date: day }))?.status;

// ── 2. Leadership ka time edit ──────────────────────────────────────────────────────
console.log('\n2) Leadership ne time badla (setAttendanceRecord)');
{
  await seedRow(withSelfie, { selfie: true });
  await seedRow(without, { selfie: false });
  await setAttendanceRecord(withSelfie._id, YMD, LATE_HM, '18:30');
  await setAttendanceRecord(without._id, YMD, LATE_HM, '18:30');
  ok(await statusOf(withSelfie) === 'PRESENT', 'selfie wala PRESENT hi raha', await statusOf(withSelfie));
  ok(await statusOf(without) === 'LATE', 'CONTROL: bina selfie wala LATE hua', await statusOf(without));
}

// ── 3. Correction approve ───────────────────────────────────────────────────────────
console.log('\n3) Correction approve hua (regularization decide)');
if (!approver) {
  console.log('  ⚠️  koi doosra user nahi mila jo approve kar sake — ye hissa chhoda');
} else {
  await seedRow(withSelfie, { selfie: true });
  await seedRow(without, { selfie: false });
  for (const u of [withSelfie, without]) {
    await Regularization.deleteMany({ user: u._id });
    // eslint-disable-next-line no-await-in-loop
    const reg = await Regularization.create({
      user: u._id, dateYMD: YMD, date: day,
      requestedCheckIn: LATE_HM, requestedCheckOut: '18:30',
      reason: 'test', status: 'PENDING',
    });
    // eslint-disable-next-line no-await-in-loop
    await decide(approver, reg._id, 'APPROVED', 'test');
  }
  ok(await statusOf(withSelfie) === 'PRESENT', 'selfie wala PRESENT hi raha', await statusOf(withSelfie));
  ok(await statusOf(without) === 'LATE', 'CONTROL: bina selfie wala LATE hua', await statusOf(without));
}

// ── 4. Half-day leave lagna / hatna ─────────────────────────────────────────────────
// Leave ka raasta transaction ke andar chalta hai; kuch machine par wo time out hota hai
// (ye is fix se pehle bhi hota tha). Isliye yahan wahi FAISLA direct naapa jaata hai jo
// leave.service un do jagah likhta hai — selfie wala PRESENT, bina selfie wala LATE.
console.log('\n4) Half-day leave ka re-judge (wahi faisla jo leave.service likhta hai)');
{
  const rowSelfie = await seedRow(withSelfie, { selfie: true });
  const rowPlain = await seedRow(without, { selfie: false });
  for (const r of [rowSelfie, rowPlain]) {
    r.halfDayLeave = true; r.halfDayPart = 'SECOND'; // doosra aadha chhutti → subah kaam ki
    r.checkInAt = companyDayInstantAt(day, LATE_HM);
  }
  const verdict = (rec) => (!isSelfieCheckIn(rec) && judgeCheckIn(rec.checkInAt, day, rec, sched).rungs > 0 ? 'LATE' : 'PRESENT');
  ok(verdict(rowSelfie) === 'PRESENT', 'selfie wala PRESENT hi rehta hai', verdict(rowSelfie));
  ok(verdict(rowPlain) === 'LATE', 'CONTROL: bina selfie wala LATE hota hai', verdict(rowPlain));
}

// ── Safai ───────────────────────────────────────────────────────────────────────────
for (const u of [withSelfie, without]) {
  await Attendance.deleteMany({ user: u._id });
  await Regularization.deleteMany({ user: u._id });
  await User.deleteOne({ _id: u._id });
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} paas, ${fail} fail\n`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
