/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * NIYAM (owner, 12 Sep 2026): grace ke baad jitne minute late aaye, us din ka overtime
 * utne hi minute baad se ginega. 10:05 aur 10:35 wale dono 7:30 ko nikle to pehle dono ko
 * barabar overtime milta tha — ab 10:35 wale ka 19 minute (10:35 − 10:16) baad se shuru
 * hoga. Har banda apne shift/grace/buffer se napa jaata hai.
 *
 * Do hisse: (1) pure math — computeWork/lateMinutesBeyondGrace bina DB ke, (2) poora
 * service path — check-in/check-out, leadership edit, regularization, excuse, recompute,
 * aur mahine ke points — sab throwaway DB par.
 *
 * Run (backend folder se):  node scripts/test-overtime-late-shift.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_otlateshift'; // throwaway DB

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Attendance } from '../src/models/Attendance.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { loadRoles } from '../src/lib/roles.js';
import { companyDayFromYMD, companyDayInstantAt, computeWork, lateMinutesBeyondGrace } from '../src/lib/time.js';
import { effectiveSchedule } from '../src/lib/schedule.js';
import { setAttendanceRecord, excuseLate, recomputeAllOvertime, otLateShift, OT_LATE_SHIFT_FLOOR_YMD } from '../src/services/attendance.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}

const D = '2026-09-15'; // Tuesday, floor ke baad
const day = companyDayFromYMD(D);
const at = (hhmm, ymd = D) => companyDayInstantAt(companyDayFromYMD(ymd), hhmm);

console.log('\n🧪 overtime — late aaye to overtime der se\n');

// ═══════════════ PART 1: PURE MATH ═══════════════
console.log('PART 1 — pure math (10:00–18:00, grace 16, buffer 60 → OT normally from 19:00)');
{
  const WS = '10:00', WE = '18:00', G = 16, B = 60;
  const late = (hhmm) => lateMinutesBeyondGrace(at(hhmm), day, WS, G);
  check('10:00 → 0 late', late('10:00') === 0);
  check('10:16 (grace ka aakhri minute) → 0', late('10:16') === 0, String(late('10:16')));
  check('10:17 → 1', late('10:17') === 1, String(late('10:17')));
  check('10:20 → 4', late('10:20') === 4);
  check('10:35 → 19', late('10:35') === 19);
  check('09:30 (jaldi) → 0, negative nahi', late('09:30') === 0);

  // Owner ka exact example: dono 19:30 ko nikle
  const a = computeWork(at('10:05'), at('19:30'), day, WE, B, late('10:05'));
  const b = computeWork(at('10:35'), at('19:30'), day, WE, B, late('10:35'));
  check('10:05 wale ko 30 min OT (19:00 se)', a.overtimeMinutes === 30, String(a.overtimeMinutes));
  check('10:35 wale ko 11 min OT (19:19 se)', b.overtimeMinutes === 11, String(b.overtimeMinutes));
  check('workedMinutes par koi asar nahi (10:35→19:30 = 535)', b.workedMinutes === 535, String(b.workedMinutes));

  // Owner ka doosra example: 10:20 → OT 19:04 se (unhone 7:05 kaha tha 15 grace maan kar; prod me 16 hai)
  const c = computeWork(at('10:20'), at('20:00'), day, WE, B, late('10:20'));
  check('10:20 in, 20:00 out → 56 min OT (19:04 se)', c.overtimeMinutes === 56, String(c.overtimeMinutes));

  // Shift se zyada late — threshold aage khisak jaye, OT 0
  const d = computeWork(at('10:50'), at('19:30'), day, WE, B, late('10:50'));
  check('10:50 in (34 late), 19:30 out → OT 0 (19:34 se ginta)', d.overtimeMinutes === 0, String(d.overtimeMinutes));

  // lateShift default 0 = purana behaviour, bilkul waisa
  const e = computeWork(at('10:35'), at('19:30'), day, WE, B);
  check('lateShift diye bina → purana jawab 30 (backward compatible)', e.overtimeMinutes === 30);

  // Alag shift: 11:00–19:00, grace 16, buffer 60 → OT 20:00 se
  const f = computeWork(at('11:30'), at('21:00'), day, '19:00', 60, lateMinutesBeyondGrace(at('11:30'), day, '11:00', 16));
  check('11–7 wala 11:30 aaya (14 late), 21:00 gaya → 46 min OT', f.overtimeMinutes === 46, String(f.overtimeMinutes));

  // Buffer 0, grace 0 (Naimish jaisa): 18:00–20:00
  const g = computeWork(at('18:10'), at('21:00'), day, '20:00', 0, lateMinutesBeyondGrace(at('18:10'), day, '18:00', 0));
  check('18–20 grace 0: 18:10 aaya, 21:00 gaya → 50 min OT (20:10 se)', g.overtimeMinutes === 50, String(g.overtimeMinutes));
}

// ═══════════════ PART 2: SERVICE PATH ═══════════════
async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO', rank: 0, permissions: ['markAttendance', 'manageUsers'], isSystem: true },
    { key: 'TEAM', label: 'Team', rank: 40, permissions: ['markAttendance'], isSystem: true },
  ]);
  await loadRoles();
  const RULES = [{ key: 'overtimeHour', points: 2 }, { key: 'lateArrival', points: -1 }];
  await Setting.create({
    key: 'global', companyName: 'TestCo', weekendDays: [0],
    workStart: '10:00', workEnd: '18:00', graceMinutes: 16, overtimeAfterMinutes: 60,
    bonus: { enabled: true, rupeesPerPoint: 0, graceDays: 0, autoRules: RULES,
      rateHistory: [{ effectiveFrom: '2026-01-01', graceDays: 0, rules: RULES, changedAt: new Date() }] },
  });
  Setting.invalidateCache();
  const boss = await User.create({ name: 'Boss', email: 'b@t.co', passwordHash: 'x', role: 'CEO_PRESIDENT', employeeId: 'O-B', isActive: true });
  const early = await User.create({ name: 'Early Bird', email: 'e@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'O-E', isActive: true, dateOfJoining: new Date('2026-01-01') });
  const late = await User.create({ name: 'Late Comer', email: 'l@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'O-L', isActive: true, dateOfJoining: new Date('2026-01-01') });
  const eleven = await User.create({
    name: 'Eleven Shift', email: '11@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'O-11', isActive: true, dateOfJoining: new Date('2026-01-01'),
    schedule: { workStart: '11:00', workEnd: '19:00', graceMinutes: 16, overtimeAfterMinutes: 60, workDays: [1, 2, 3, 4, 5, 6] },
  });
  const settings = await Setting.getSingleton();
  const otOf = async (u, ymd = D) => (await Attendance.findOne({ user: u._id, date: companyDayFromYMD(ymd) }))?.overtimeMinutes ?? null;
  const otPts = async (u, month = D.slice(0, 7)) => (await PointEntry.findOne({ user: u._id, source: 'auto_ot', month }))?.points ?? 0;

  // ═══ TEST 1 — owner ka scenario, leadership-edit path se ═══
  console.log('TEST 1 — 10:05 aur 10:35 wale dono 19:30 ko nikle');
  await setAttendanceRecord(early._id, D, '10:05', '19:30');
  await setAttendanceRecord(late._id, D, '10:35', '19:30');
  check('Early Bird: 30 min OT', (await otOf(early)) === 30, String(await otOf(early)));
  check('Late Comer: 11 min OT (19 min late → 19:19 se)', (await otOf(late)) === 11, String(await otOf(late)));
  check('Late Comer ka status LATE', (await Attendance.findOne({ user: late._id })).status === 'LATE');
  check('Early Bird ka status PRESENT (grace ke andar)', (await Attendance.findOne({ user: early._id })).status === 'PRESENT');

  // ═══ TEST 2 — apni shift wala (11–7) ═══
  console.log('\nTEST 2 — 11–7 wala apne hisaab se');
  await setAttendanceRecord(eleven._id, D, '11:30', '21:00');
  check('11:30 aaya (14 late), 21:00 gaya → 46 min OT (20:14 se)', (await otOf(eleven)) === 46, String(await otOf(eleven)));
  await setAttendanceRecord(eleven._id, D, '11:10', '21:00');
  check('11:10 aaya (grace me) → 60 min OT (20:00 se)', (await otOf(eleven)) === 60, String(await otOf(eleven)));

  // ═══ TEST 3 — excuse: on-duty late = OT wapas ═══
  console.log('\nTEST 3 — leadership ne late ko excuse (on-duty) kiya');
  const lateRec = await Attendance.findOne({ user: late._id, date: day });
  await excuseLate(boss, lateRec._id, true);
  check('excuse ke baad OT 30 (shift hat gayi)', (await otOf(late)) === 30, String(await otOf(late)));
  await excuseLate(boss, lateRec._id, false);
  check('un-excuse par wapas 11', (await otOf(late)) === 11, String(await otOf(late)));

  // ═══ TEST 4 — floor se PEHLE ka din: purana niyam ═══
  console.log(`\nTEST 4 — ${OT_LATE_SHIFT_FLOOR_YMD} se pehle ka din: koi shift nahi`);
  const OLD = '2026-09-08'; // Tuesday, floor se pehle
  await setAttendanceRecord(late._id, OLD, '10:35', '19:30');
  check('8 Sep: 10:35 aaya phir bhi 30 min OT (purana niyam)', (await otOf(late, OLD)) === 30, String(await otOf(late, OLD)));
  check('8 Sep: status phir bhi LATE (sirf OT ki baat hai, late-mark nahi badla)', (await Attendance.findOne({ user: late._id, date: companyDayFromYMD(OLD) })).status === 'LATE');
  // floor ke theek din par lagta hai
  await setAttendanceRecord(late._id, OT_LATE_SHIFT_FLOOR_YMD, '10:35', '19:30');
  check(`${OT_LATE_SHIFT_FLOOR_YMD} (floor ka din): 11 min`, (await otOf(late, OT_LATE_SHIFT_FLOOR_YMD)) === 11, String(await otOf(late, OT_LATE_SHIFT_FLOOR_YMD)));

  // ═══ TEST 5 — recomputeAllOvertime purane din na chhede, naye par sahi rahe ═══
  console.log('\nTEST 5 — office-wide recompute: purana waisa, naya waisa');
  await recomputeAllOvertime();
  check('8 Sep ab bhi 30', (await otOf(late, OLD)) === 30, String(await otOf(late, OLD)));
  check('15 Sep ab bhi 11', (await otOf(late)) === 11, String(await otOf(late)));
  check('Early Bird ab bhi 30', (await otOf(early)) === 30);

  // ═══ TEST 6 — mahine ke points ═══
  console.log('\nTEST 6 — mahine ke overtime points (2/hr, >30 min leftover = +1)');
  // Late Comer Sep me: 8 Sep 30 + 14 Sep 11 + 15 Sep 11 = 52 min → 0 hr, leftover 52 > 30 → +1
  check('Late Comer: 52 min → 1 point', (await otPts(late)) === 1, String(await otPts(late)));
  // Early Bird: 30 min → 0
  check('Early Bird: 30 min → 0 point (30 > 30 nahi)', (await otPts(early)) === 0, String(await otPts(early)));
  // Ab Early Bird 3 din 1 ghanta OT
  await setAttendanceRecord(early._id, '2026-09-16', '10:00', '20:00');
  await setAttendanceRecord(early._id, '2026-09-17', '10:00', '20:00');
  check('Early Bird: 30+60+60 = 150 min → 2 hr = 4 + leftover 30 → 4', (await otPts(early)) === 4, String(await otPts(early)));

  // ═══ TEST 7 — CONTROL: jo late nahi, uspar kuch na badle ═══
  console.log('\nTEST 7 — CONTROL: time par aane wale par zero asar');
  await setAttendanceRecord(early._id, '2026-09-18', '09:45', '20:00'); // jaldi
  check('09:45 aaya (jaldi) → 60 min OT, negative shift nahi', (await otOf(early, '2026-09-18')) === 60, String(await otOf(early, '2026-09-18')));
  await setAttendanceRecord(early._id, '2026-09-19', '10:16', '20:00'); // grace ka aakhri minute
  check('10:16 aaya → 60 min OT, status PRESENT', (await otOf(early, '2026-09-19')) === 60 && (await Attendance.findOne({ user: early._id, date: companyDayFromYMD('2026-09-19') })).status === 'PRESENT');

  // ═══ TEST 8 — otLateShift gate ═══
  console.log('\nTEST 8 — otLateShift ka gate');
  const sched = effectiveSchedule(late, settings);
  check('checkInAt na ho → 0', otLateShift({ status: 'LATE' }, day, sched) === 0);
  check('status PRESENT → 0', otLateShift({ checkInAt: at('10:35'), status: 'PRESENT' }, day, sched) === 0);
  check('excused → 0', otLateShift({ checkInAt: at('10:35'), status: 'LATE', excused: true }, day, sched) === 0);
  check('floor se pehle → 0', otLateShift({ checkInAt: at('10:35', OLD), status: 'LATE' }, companyDayFromYMD(OLD), sched) === 0);
  check('sab sahi → 19', otLateShift({ checkInAt: at('10:35'), status: 'LATE' }, day, sched) === 19);

  // ═══ TEST 9 — regularization: employee ne check-in sudharwaya ═══
  console.log('\nTEST 9 — regularization se check-in badla to OT bhi dobara gine');
  {
    const { createRequest, decide } = await import('../src/services/regularization.service.js');
    const R2 = '2026-09-21'; // Monday
    // Pehle 10:40 par record (24 late) → 19:30 out → 6 min OT (19:24 se)
    await setAttendanceRecord(late._id, R2, '10:40', '19:30');
    check('pehle 6 min OT (10:40 → 19:24 se)', (await otOf(late, R2)) === 6, String(await otOf(late, R2)));
    // "Main 10:10 par aaya tha, machine ne 10:40 pakda" → approve
    const reg = await createRequest(late, { dateYMD: R2, checkIn: '10:10', reason: 'machine late thi' });
    await decide(boss, reg.id || reg._id, 'APPROVED', 'ok');
    const rec = await Attendance.findOne({ user: late._id, date: companyDayFromYMD(R2) });
    check('ab status PRESENT (10:10 grace me)', rec.status === 'PRESENT', rec.status);
    check('ab 30 min OT (shift hat gayi)', rec.overtimeMinutes === 30, String(rec.overtimeMinutes));
    // Ulta: 10:10 se 10:40 karwaya
    const reg2 = await createRequest(late, { dateYMD: R2, checkIn: '10:40', reason: 'galti se' });
    await decide(boss, reg2.id || reg2._id, 'APPROVED', 'ok');
    check('wapas 10:40 → phir 6 min', (await otOf(late, R2)) === 6, String(await otOf(late, R2)));
  }

  console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PASS'}\n`);
  await mongoose.connection.dropDatabase();
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
