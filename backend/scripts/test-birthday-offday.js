/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI). Verifies the owner's
 * birthday rule: your own birthday is a day off for YOU alone — no absence, no penalty,
 * no broken streak, nothing off the leave quota, not in the report denominator — and it
 * SHOWS as "Birthday" everywhere an absence would otherwise have shown.
 *
 * Run (backend folder se):  node scripts/test-birthday-offday.js
 */
import 'dotenv/config';

process.env.MONGODB_DB = 'office_test_birthday';
process.env.APP_LIVE_YMD = '2026-07-01';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { Attendance } from '../src/models/Attendance.js';
import { loadRoles } from '../src/lib/roles.js';
import { companyDayFromYMD } from '../src/lib/time.js';
import { reconcileAbsence, runRollingStreak, maybeRunDaily } from '../src/services/bonus.service.js';
import { buildSelfReport } from '../src/services/report.service.js';
import { applyLeave } from '../src/services/leave.service.js';
import { attendanceOverview, attendanceMatrix } from '../src/services/attendance.service.js';

let fail = 0;
const ok = (n, c, x) => {
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ->  ' + x : ''}`);
  if (!c) fail += 1;
};

const BDAY = '2026-08-11'; // Tuesday — a normal working day
const NORMAL = '2026-08-12'; // Wednesday — the control day
const RULES = [
  { key: 'absentDay', points: 10 },
  { key: 'punctualStreak', points: 5 },
  { key: 'perfectAttendanceMonth', points: 20 },
];

const absenceEntry = (u, d) => PointEntry.findOne({ dedupeKey: `auto_absent:${u._id}:${d}` });

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\nIsolated DB: ${process.env.MONGODB_DB}   (birthday ${BDAY}, control day ${NORMAL})\n`);

  await Role.create([{ key: 'EMPLOYEE', label: 'Employee', rank: 50, permissions: ['markAttendance'], isSystem: true }]);
  await loadRoles();
  await Setting.create({
    key: 'global',
    companyName: 'TestCo',
    weekendDays: [0],
    workStart: '10:00',
    workEnd: '18:00',
    graceMinutes: 0,
    annualLeaveQuota: 18,
    bonus: {
      enabled: true,
      rupeesPerPoint: 0,
      graceDays: 0,
      autoRules: RULES,
      rateHistory: [{ effectiveFrom: '2026-07-01', graceDays: 0, rules: RULES, changedBy: null, changedAt: new Date() }],
    },
  });
  Setting.invalidateCache();

  const bday = await User.create({
    name: 'Bday Person', email: 'b@t.co', passwordHash: 'x', role: 'EMPLOYEE', employeeId: 'T-B',
    isActive: true, dateOfJoining: '2026-07-01', dateOfBirth: '1995-08-11',
  });
  const other = await User.create({
    name: 'Control', email: 'c@t.co', passwordHash: 'x', role: 'EMPLOYEE', employeeId: 'T-C',
    isActive: true, dateOfJoining: '2026-07-01', dateOfBirth: '1990-08-19',
  });

  // 1. The absent-day penalty
  console.log('1. Birthday pe nahi aaya — absent penalty lagti hai?');
  await reconcileAbsence(bday._id, BDAY);
  await reconcileAbsence(other._id, BDAY); // control: same day, not THEIR birthday
  await reconcileAbsence(bday._id, NORMAL); // control: same person, ordinary day
  ok('birthday wale ko koi penalty NAHI', (await absenceEntry(bday, BDAY)) === null);
  ok('CONTROL: doosre bande ko usi din -10 laga', (await absenceEntry(other, BDAY))?.points === -10, 'sabit hua ki din working tha');
  ok('CONTROL: usi bande ko normal din -10 laga', (await absenceEntry(bday, NORMAL))?.points === -10);

  // 2. The rolling punctual streak
  console.log('\n2. Birthday se punctual streak tootti hai?');
  // 11 Aug = birthday (neutral), 16 Aug = Sunday (neutral). Baaki 6 working din present.
  const present = ['2026-08-10', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-17'];
  for (const d of present) {
    await Attendance.create({ user: bday._id, date: companyDayFromYMD(d), status: 'PRESENT', checkInAt: new Date(`${d}T04:30:00Z`) });
  }
  await PointEntry.deleteMany({ user: bday._id, source: 'auto_absent' });
  await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.lastStreakScan': '2026-08-09' } });
  Setting.invalidateCache();
  await runRollingStreak((await Setting.getSingleton()).bonus);
  const streak = await PointEntry.findOne({ user: bday._id, source: 'auto_streak' });
  ok('6 on-time din pure, streak ka +5 mila', streak?.points === 5, 'birthday beech me aaya: na toota, na gina — Sunday jaisa');

  // 3. Leave quota
  console.log('\n3. Birthday ko cover karti leave quota se katti hai?');
  const lv = await applyLeave(bday, { type: 'CASUAL', startYMD: '2026-08-10', endYMD: '2026-08-12', reason: 'test' });
  ok('3 din ki leave me se sirf 2 kate (birthday free)', lv.workingDays === 2, `workingDays=${lv.workingDays}`);

  // 4. The person's own report
  console.log('\n4. Report me birthday kaise dikhta hai?');
  const rep = await buildSelfReport({ user: bday, type: 'custom', dateYMD: '2026-08-20', range: { from: '2026-08-10', to: '2026-08-13' } });
  const row = (rep.attendance?.days || []).find((d) => d.ymd === BDAY);
  const ctrlRow = (rep.attendance?.days || []).find((d) => d.ymd === NORMAL);
  ok('us din ka status BIRTHDAY (ABSENT nahi)', row?.status === 'BIRTHDAY', `status=${row?.status}`);
  ok('label "Birthday" dikhta hai', row?.statusLabel === 'Birthday', `label=${row?.statusLabel}`);
  ok('working-day me NAHI gina', row?.isWorkingDay === false, `isWorkingDay=${row?.isWorkingDay}`);
  ok('CONTROL: normal din working-day me gina', ctrlRow?.isWorkingDay === true);

  // 5. The Attendance page
  console.log('\n5. Attendance page pe kya dikhega?');
  const ov = await attendanceOverview(BDAY);
  const mine = ov.rows.find((r) => String(r.user.id) === String(bday._id));
  const theirs = ov.rows.find((r) => String(r.user.id) === String(other._id));
  ok('birthday wale ka status BIRTHDAY', mine?.status === 'BIRTHDAY', `got ${mine?.status}`);
  ok('CONTROL: doosre ka usi din ABSENT', theirs?.status === 'ABSENT', `got ${theirs?.status}`);
  const mx = await attendanceMatrix('2026-08');
  const mrow = mx.rows.find((r) => String(r.user.id) === String(bday._id));
  ok('month sheet ka cell "B" hai (A nahi)', mrow?.cells[mx.days.indexOf(BDAY)] === 'B', `cell=${mrow?.cells[mx.days.indexOf(BDAY)]}`);
  const bCells = (mrow?.cells || []).filter((c) => c === 'B').length;
  ok('poore mahine me sirf 1 "B" cell', bCells === 1, `B cells=${bCells}`);
  const ctrlRowMx = mx.rows.find((r) => String(r.user.id) === String(other._id));
  ok('CONTROL: usi din uska cell "A" hai', ctrlRowMx?.cells[mx.days.indexOf(BDAY)] === 'A', `cell=${ctrlRowMx?.cells[mx.days.indexOf(BDAY)]}`);

  // 6. Coming in on your birthday
  console.log('\n6. Birthday pe office aa gaya to?');
  await Attendance.create({ user: other._id, date: companyDayFromYMD('2026-08-19'), status: 'PRESENT', checkInAt: new Date('2026-08-19T04:30:00Z') });
  const ov2 = await attendanceOverview('2026-08-19'); // control's own birthday, and they came in
  const came = ov2.rows.find((r) => String(r.user.id) === String(other._id));
  ok('aane pe attendance normally lagi (PRESENT)', came?.status === 'PRESENT', `got ${came?.status}`);

  // 7. The one-time migration
  console.log('\n7. Migration: pehle se lagi galat penalty hatti hai?');
  await PointEntry.create({
    user: bday._id, month: '2026-08', earnedYMD: BDAY, points: -10,
    reason: 'Absent (purani galti)', source: 'auto_absent', dedupeKey: `auto_absent:${bday._id}:${BDAY}`,
  });
  await Setting.updateOne({ key: 'global' }, { $unset: { 'bonus.birthdayOffDayV1': '' } });
  Setting.invalidateCache();
  await maybeRunDaily(true);
  ok('birthday wali purani penalty hat gayi', (await absenceEntry(bday, BDAY)) === null);
  Setting.invalidateCache();
  const fin = await Setting.findOne({ key: 'global' }).lean();
  ok('migration ka flag DB me tika', fin.bonus.birthdayOffDayV1 === true, `got ${fin.bonus.birthdayOffDayV1}`);

  await mongoose.connection.dropDatabase();
  await disconnectDB();
  console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAIL`}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
