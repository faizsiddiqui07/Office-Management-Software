/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * Late ladder (owner ka niyam, 12 Sep 2026, floor 13 Sep):
 *   • Normal din: grace ke baad = 1 rung, start ke ek poore ghante ke baad = 2 rung — bas,
 *     isse zyada kabhi nahi (12:01 = 11:01 = −2).
 *   • Half-day ka AFTERNOON (first-half leave): shift ke beech (10–6 → 2:00 PM) se due, grace
 *     ZERO — 2:01 = 1, phir har ghante ek aur (3:01 = 2, 4:01 = 3, 5:01 = 4) end time tak.
 *   • Half-day ka MORNING (second-half leave): kabhi late nahi (purana niyam).
 *   • Floor se pehle: flat −1, half-day kabhi late nahi.
 * Har rung = lateArrival ke points. Sab apni-apni shift se.
 *
 * Yahan ghadi ko haath se set karke (fake Date) self check-in, leadership edit, excuse,
 * regularization, half-day leave approve/cancel aur month-backfill — har raasta chala kar
 * ledger ki row (points + reason) check hoti hai. "Nahi katna chahiye" wale checks bhi hain.
 *
 * Run (backend folder se):  node scripts/test-late-ladder.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_lateladder'; // throwaway DB

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Attendance } from '../src/models/Attendance.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { LeaveRequest } from '../src/models/LeaveRequest.js';
import { RuleSection } from '../src/models/RuleSection.js';
import { loadRoles } from '../src/lib/roles.js';
import { companyDayFromYMD } from '../src/lib/time.js';
import { lateMarksHM, judgeCheckIn, penaltyRungs, lateReasonText, shiftMidpoint, LATE_LADDER_FLOOR_YMD } from '../src/lib/lateLadder.js';
import * as att from '../src/services/attendance.service.js';
import * as leave from '../src/services/leave.service.js';
import * as reg from '../src/services/regularization.service.js';
import { backfillMonth } from '../src/services/bonus.service.js';
import * as rules from '../src/controllers/rules.controller.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}

/** IST ka ek pal: ('2026-09-14', '10:16:30') → Date */
const at = (ymd, hms = '00:00:00') => new Date(`${ymd}T${hms.length === 5 ? `${hms}:00` : hms}+05:30`);

// ── Fake clock: service code `new Date()` se "abhi" leta hai — usko yahan se set karte hain
// (Ek function jo ASLI Date lautata hai — subclass nahi: Mongoose/BSON subclass ko Date
// nahi maanta aur number bana kar store kar deta hai.)
const RealDate = Date;
let FAKE_NOW = RealDate.now();
function FakeDate(...a) { return new RealDate(...(a.length ? a : [FAKE_NOW])); }
FakeDate.prototype = RealDate.prototype;
FakeDate.now = () => FAKE_NOW;
FakeDate.UTC = RealDate.UTC;
FakeDate.parse = RealDate.parse;
const setClock = (d) => { FAKE_NOW = d.getTime(); };
globalThis.Date = FakeDate;

const lateRow = (uid, ymd) => PointEntry.findOne({ dedupeKey: `auto_late:${uid}:${ymd}` }).lean();
const rowStr = (r) => (r ? `${r.points} "${r.reason}"` : 'no row');
const rec = (uid, ymd) => Attendance.findOne({ user: uid, date: companyDayFromYMD(ymd) });

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}   (floor ${LATE_LADDER_FLOOR_YMD})\n`);

  const S10 = { workStart: '10:00', workEnd: '18:00', graceMinutes: 16 };
  const S11 = { workStart: '11:00', workEnd: '20:00', graceMinutes: 16 };
  const S18 = { workStart: '18:00', workEnd: '20:00', graceMinutes: 0 };
  const S930 = { workStart: '09:30', workEnd: '18:30', graceMinutes: 16 };
  const SU = { workStart: '11:00', workEnd: '19:30', graceMinutes: 15 };
  const HALF = { halfDayLeave: true, halfDayPart: 'FIRST' };
  const HALF2 = { halfDayLeave: true, halfDayPart: 'SECOND' };
  const D = '2026-09-14'; // Monday, floor ke baad
  const PRE = '2026-09-10'; // floor se pehle
  const day = companyDayFromYMD(D);
  const j = (hms, r, s, ymd = D) => judgeCheckIn(at(ymd, hms), companyDayFromYMD(ymd), r, s).rungs;

  // ═══ PART A — ladder ka shuddh hisab (koi DB nahi) ═══
  console.log('PART A — marks aur rungs, shift-dar-shift');
  check('10–6 grace 16 → marks 10:16, 11:00', lateMarksHM(D, null, S10).join(',') === '10:16,11:00', lateMarksHM(D, null, S10).join(','));
  check('10:16:00 sharp → 0 (grace ke andar)', j('10:16:00', null, S10) === 0);
  check('10:16:30 → 1 (grace ek second bhi paar = late)', j('10:16:30', null, S10) === 1);
  check('10:40 → 1', j('10:40', null, S10) === 1);
  check('11:00:00 sharp → 1 (mark PAR hona = paar nahi)', j('11:00:00', null, S10) === 1);
  check('11:00:01 → 2 ("faoran baad")', j('11:00:01', null, S10) === 2);
  check('12:01 → 2 (teesra rung NAHI — max 2)', j('12:01', null, S10) === 2);
  check('14:01 → 2 (dopahar bhi 2 hi)', j('14:01', null, S10) === 2);
  check('17:59 → 2', j('17:59', null, S10) === 2);
  check('18:30 → 2 (end ke baad bhi 2)', j('18:30', null, S10) === 2);
  check(`floor se pehle (${PRE}) 12:20 → 1 (purana flat niyam)`, j('12:20', null, S10, PRE) === 1);
  check(`floor se pehle ${PRE} marks = sirf 10:16`, lateMarksHM(PRE, null, S10).join(',') === '10:16');
  check('11–8 grace 16 → marks 11:16, 12:00', lateMarksHM(D, null, S11).join(',') === '11:16,12:00');
  check('11–8: 11:16 → 0, 11:17 → 1, 12:00 → 1, 12:01 → 2, 15:00 → 2', j('11:16', null, S11) === 0 && j('11:17', null, S11) === 1 && j('12:00', null, S11) === 1 && j('12:01', null, S11) === 2 && j('15:00', null, S11) === 2);
  check('6–8 PM grace 0 → marks 18:00, 19:00', lateMarksHM(D, null, S18).join(',') === '18:00,19:00');
  check('6–8 PM: 18:00 → 0, 18:00:30 → 1, 19:01 → 2, 20:30 → 2', j('18:00:00', null, S18) === 0 && j('18:00:30', null, S18) === 1 && j('19:01', null, S18) === 2 && j('20:30', null, S18) === 2);
  check('9:30–6:30 → marks 09:46, 10:30', lateMarksHM(D, null, S930).join(',') === '09:46,10:30');
  check('9:30 shift: 10:30:00 → 1, 10:31 → 2', j('10:30:00', null, S930) === 1 && j('10:31', null, S930) === 2);
  check('11–7:30 grace 15 → marks 11:15, 12:00', lateMarksHM(D, null, SU).join(',') === '11:15,12:00');
  check('grace 60 (edge) → marks 11:00, 12:00 — grace ke andar ka ghanta rung nahi', lateMarksHM(D, null, { ...S10, graceMinutes: 60 }).join(',') === '11:00,12:00');
  check('grace 75 (edge) → marks 11:15, 12:00', lateMarksHM(D, null, { ...S10, graceMinutes: 75 }).join(',') === '11:15,12:00');

  console.log('PART A2 — half-day ka afternoon (first-half leave)');
  check('10–6 midpoint 14:00; 11–8 → 15:30; 6–8 PM → 19:00; 11–7:30 → 15:15; 9:30–6:30 → 14:00',
    shiftMidpoint('10:00', '18:00') === '14:00' && shiftMidpoint('11:00', '20:00') === '15:30' && shiftMidpoint('18:00', '20:00') === '19:00' && shiftMidpoint('11:00', '19:30') === '15:15' && shiftMidpoint('09:30', '18:30') === '14:00');
  check('10–6 afternoon marks = 14:00, 15:00, 16:00, 17:00 (18:00 nahi — end time)', lateMarksHM(D, HALF, S10).join(',') === '14:00,15:00,16:00,17:00', lateMarksHM(D, HALF, S10).join(','));
  check('13:59 → 0, 14:00:00 → 0, 14:00:30 → 1 (grace ZERO), 14:01 → 1', j('13:59', HALF, S10) === 0 && j('14:00:00', HALF, S10) === 0 && j('14:00:30', HALF, S10) === 1 && j('14:01', HALF, S10) === 1);
  check('15:00 → 1, 15:01 → 2, 16:01 → 3, 17:01 → 4, 18:30 → 4 (6 baje tak, uske baad wahi)', j('15:00:00', HALF, S10) === 1 && j('15:01', HALF, S10) === 2 && j('16:01', HALF, S10) === 3 && j('17:01', HALF, S10) === 4 && j('18:30', HALF, S10) === 4);
  check('afternoon me subah 10:40 aana → 0 (2 baje se pehle = time par)', j('10:40', HALF, S10) === 0);
  check('11–8 afternoon marks = 15:30 … 19:30 (5)', lateMarksHM(D, HALF, S11).join(',') === '15:30,16:30,17:30,18:30,19:30');
  check('6–8 PM afternoon marks = sirf 19:00', lateMarksHM(D, HALF, S18).join(',') === '19:00');
  check('11–7:30 afternoon marks = 15:15 … 19:15', lateMarksHM(D, HALF, SU).join(',') === '15:15,16:15,17:15,18:15,19:15');
  check('MORNING half (second-half leave) → koi mark nahi, 10:40 → 0', lateMarksHM(D, HALF2, S10).length === 0 && j('10:40', HALF2, S10) === 0);
  check(`floor se pehle half-day afternoon (${PRE}) → koi mark nahi, 16:10 → 0`, lateMarksHM(PRE, HALF, S10).length === 0 && j('16:10', HALF, S10, PRE) === 0);
  check('afternoon flag = sirf FIRST-half + floor ke baad', judgeCheckIn(at(D, '14:30'), day, HALF, S10).afternoon === true && judgeCheckIn(at(D, '14:30'), day, HALF2, S10).afternoon === false && judgeCheckIn(at(PRE, '14:30'), companyDayFromYMD(PRE), HALF, S10).afternoon === false);

  console.log('PART A3 — penaltyRungs (stored record kya owe karta hai) aur reason text');
  const mk = (hms, extra = {}) => ({ checkInAt: at(D, hms), status: 'LATE', excused: false, ...extra });
  check('LATE 12:20 → 2', penaltyRungs(mk('12:20'), day, S10).rungs === 2);
  check('LATE 12:20 excused → 0', penaltyRungs(mk('12:20', { excused: true }), day, S10).rungs === 0);
  check('PRESENT 12:20 → 0 (status hi late nahi)', penaltyRungs(mk('12:20', { status: 'PRESENT' }), day, S10).rungs === 0);
  check('LATE par ladder 0 kahe (schedule baad me badli) → phir bhi 1', penaltyRungs(mk('10:05'), day, S10).rungs === 1);
  check('LATE half-day MORNING → 0 (window band)', penaltyRungs(mk('10:40', HALF2), day, S10).rungs === 0);
  check('LATE half-day AFTERNOON 16:10 → 3, afternoon=true', penaltyRungs(mk('16:10', HALF), day, S10).rungs === 3 && penaltyRungs(mk('16:10', HALF), day, S10).afternoon === true);
  check('reason 1 rung = purana hi text', lateReasonText(D, { rungs: 1 }) === `Late arrival · ${D}`);
  check('reason 2 rungs', lateReasonText(D, { rungs: 2 }) === `Late arrival · ${D} · over 1 hour late`, lateReasonText(D, { rungs: 2 }));
  check('reason afternoon 3 rungs', lateReasonText(D, { rungs: 3, afternoon: true }) === `Late arrival (afternoon half) · ${D} · over 2 hours late`, lateReasonText(D, { rungs: 3, afternoon: true }));

  // ═══ PART B — asli raaste, DB ke saath ═══
  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO', rank: 0, permissions: ['approveLeave', 'manageAttendance', 'viewEveryone'], isSystem: true },
    { key: 'TEAM', label: 'Team', rank: 40, permissions: [], isSystem: true },
  ]);
  await loadRoles();
  await Setting.create({
    key: 'global', companyName: 'TestCo', weekendDays: [0], workStart: '10:00', workEnd: '18:00', graceMinutes: 16, overtimeAfterMinutes: 60,
    bonus: { enabled: true, rupeesPerPoint: 100, graceDays: 1, autoRules: [{ key: 'lateArrival', points: -1 }, { key: 'overtimeHour', points: 2 }] },
    halfDayPartBackfilled: true, halfDayLateFixed: true,
  });
  Setting.invalidateCache();
  const boss = await User.create({ name: 'Boss', email: 'b@t.co', passwordHash: 'x', role: 'CEO_PRESIDENT', employeeId: 'R-B', isActive: true, joinedAt: new Date('2025-01-01') });
  const A = await User.create({ name: 'Aam', email: 'a@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'R-A', isActive: true, joinedAt: new Date('2025-01-01') });
  const K = await User.create({ name: 'Kanaujiya', email: 'k@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'R-K', isActive: true, joinedAt: new Date('2025-01-01'), schedule: { workStart: '11:00', workEnd: '20:00', graceMinutes: 16, overtimeAfterMinutes: 0 } });
  const N = await User.create({ name: 'Naim', email: 'n@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'R-N', isActive: true, joinedAt: new Date('2025-01-01'), employmentType: 'PART_TIME', schedule: { workStart: '18:00', workEnd: '20:00', graceMinutes: 0, workDays: [0, 6] } });

  console.log('\nPART B1 — self check-in (ghadi set karke)');
  const selfIn = async (u, ymd, hms) => { setClock(at(ymd, hms)); return att.checkIn(u, {}, null, null); };
  {
    let r = await selfIn(A, '2026-09-14', '10:10');
    check('Mon 14 Sep 10:10 → PRESENT, koi row nahi', r.status === 'PRESENT' && !(await lateRow(A._id, '2026-09-14')));
    r = await selfIn(A, '2026-09-15', '10:40');
    let row = await lateRow(A._id, '2026-09-15');
    check('Tue 10:40 → LATE, −1 "Late arrival · 2026-09-15"', r.status === 'LATE' && row?.points === -1 && row.reason === 'Late arrival · 2026-09-15', rowStr(row));
    r = await selfIn(A, '2026-09-16', '12:20');
    row = await lateRow(A._id, '2026-09-16');
    check('Wed 12:20 → LATE, −2 "… over 1 hour late"', r.status === 'LATE' && row?.points === -2 && row.reason === 'Late arrival · 2026-09-16 · over 1 hour late', rowStr(row));
    r = await selfIn(A, '2026-09-17', '17:30');
    row = await lateRow(A._id, '2026-09-17');
    check('Thu 17:30 → −2 hi (cap)', row?.points === -2, rowStr(row));
    r = await selfIn(K, '2026-09-14', '11:53');
    row = await lateRow(K._id, '2026-09-14');
    check('11–8 wala 11:53 → −1 (uska 12:00 abhi nahi aaya)', r.status === 'LATE' && row?.points === -1, rowStr(row));
    r = await selfIn(K, '2026-09-15', '12:05');
    row = await lateRow(K._id, '2026-09-15');
    check('11–8 wala 12:05 → −2', row?.points === -2, rowStr(row));
    r = await selfIn(N, '2026-09-13', '19:10'); // Sunday — uska working day
    row = await lateRow(N._id, '2026-09-13');
    check('6–8 PM part-timer Sun 19:10 → −2 (18:00 aur 19:00 dono paar)', r.status === 'LATE' && row?.points === -2, rowStr(row));
    r = await selfIn(A, '2026-09-20', '12:20'); // Sunday — A ka off day
    check('A ka Sunday 12:20 → PRESENT, koi row nahi (off day)', r.status === 'PRESENT' && !(await lateRow(A._id, '2026-09-20')));
    r = await selfIn(A, '2026-09-11', '12:20'); // floor se pehle
    row = await lateRow(A._id, '2026-09-11');
    check('floor se pehle (11 Sep) 12:20 → −1 flat', r.status === 'LATE' && row?.points === -1 && row.reason === 'Late arrival · 2026-09-11', rowStr(row));
  }

  console.log('\nPART B2 — leadership edit (setAttendanceRecord) → replace se rung badalta hai');
  {
    await att.setAttendanceRecord(A._id, '2026-09-21', '12:20', '19:00');
    let row = await lateRow(A._id, '2026-09-21');
    check('type 12:20 → −2', row?.points === -2, rowStr(row));
    await att.setAttendanceRecord(A._id, '2026-09-21', '10:30', '19:00');
    row = await lateRow(A._id, '2026-09-21');
    check('phir 10:30 kar diya → −1 (row update hui, purani −2 nahi rahi)', row?.points === -1 && row.reason === 'Late arrival · 2026-09-21', rowStr(row));
    await att.setAttendanceRecord(A._id, '2026-09-21', '10:05', '19:00');
    check('phir 10:05 → PRESENT, row gayab', (await rec(A._id, '2026-09-21')).status === 'PRESENT' && !(await lateRow(A._id, '2026-09-21')));
    await att.setAttendanceRecord(A._id, '2026-09-21', '11:01', '19:00');
    row = await lateRow(A._id, '2026-09-21');
    check('phir 11:01 → −2 wapas', row?.points === -2, rowStr(row));
    await att.setAttendanceRecord(A._id, '2026-09-09', '12:20', '19:00'); // floor se pehle
    row = await lateRow(A._id, '2026-09-09');
    check('floor se pehle ka din edit → −1 hi (purana niyam)', row?.points === -1, rowStr(row));
  }

  console.log('\nPART B3 — excuse / un-excuse');
  {
    const r = await rec(A._id, '2026-09-16'); // 12:20 → −2
    await att.excuseLate(boss, r._id, true);
    check('excused → row gayab', !(await lateRow(A._id, '2026-09-16')));
    await att.excuseLate(boss, r._id, false);
    const row = await lateRow(A._id, '2026-09-16');
    check('un-excused → −2 wapas (1 nahi)', row?.points === -2, rowStr(row));
  }

  console.log('\nPART B4 — regularization (correction approve)');
  {
    setClock(at('2026-09-23', '20:00'));
    const rq = await reg.createRequest(A, { dateYMD: '2026-09-22', checkIn: '12:20', checkOut: '19:00', reason: 'bhool gaya' });
    await reg.decide(boss, rq.id || rq._id, 'APPROVED', '');
    const row = await lateRow(A._id, '2026-09-22');
    check('correction 12:20 approve → LATE, −2', (await rec(A._id, '2026-09-22')).status === 'LATE' && row?.points === -2, rowStr(row));
    const rq2 = await reg.createRequest(A, { dateYMD: '2026-09-22', checkIn: '10:10', reason: 'galat likha tha' });
    await reg.decide(boss, rq2.id || rq2._id, 'APPROVED', '');
    check('dobara correction 10:10 → PRESENT, row gayab', (await rec(A._id, '2026-09-22')).status === 'PRESENT' && !(await lateRow(A._id, '2026-09-22')));
  }

  console.log('\nPART B5 — half-day: leave pehle approve, phir check-in');
  const halfLeave = async (u, ymd, part) => {
    setClock(at(ymd, '08:00'));
    const lr = await leave.applyLeave(u, { type: 'SICK', startYMD: ymd, endYMD: ymd, halfDay: true, halfDayPart: part, reason: 't' });
    await leave.decideLeave(boss, lr.id || lr._id, 'APPROVE', '');
    return LeaveRequest.findById(lr.id || lr._id);
  };
  {
    await halfLeave(A, '2026-09-24', 'FIRST');
    let r = await selfIn(A, '2026-09-24', '14:40');
    let row = await lateRow(A._id, '2026-09-24');
    check('FIRST-half leave, 14:40 aaya → LATE, −1 "(afternoon half)"', r.status === 'LATE' && r.halfDayLeave === true && row?.points === -1 && row.reason === 'Late arrival (afternoon half) · 2026-09-24', rowStr(row));
    await halfLeave(A, '2026-09-25', 'FIRST');
    r = await selfIn(A, '2026-09-25', '16:10');
    row = await lateRow(A._id, '2026-09-25');
    check('FIRST-half leave, 16:10 aaya → −3 "over 2 hours late"', row?.points === -3 && row.reason === 'Late arrival (afternoon half) · 2026-09-25 · over 2 hours late', rowStr(row));
    await halfLeave(A, '2026-09-26', 'FIRST');
    r = await selfIn(A, '2026-09-26', '13:55');
    check('FIRST-half leave, 13:55 aaya → PRESENT, koi row nahi', r.status === 'PRESENT' && !(await lateRow(A._id, '2026-09-26')));
    await halfLeave(A, '2026-09-28', 'SECOND');
    r = await selfIn(A, '2026-09-28', '10:40');
    check('SECOND-half leave (subah kaam), 10:40 aaya → PRESENT, koi row nahi (purana niyam)', r.status === 'PRESENT' && !(await lateRow(A._id, '2026-09-28')));
    await halfLeave(K, '2026-09-24', 'FIRST');
    r = await selfIn(K, '2026-09-24', '15:35');
    row = await lateRow(K._id, '2026-09-24');
    check('11–8 wale ka FIRST-half, 15:35 aaya (midpoint 15:30) → −1', r.status === 'LATE' && row?.points === -1, rowStr(row));
    await halfLeave(A, '2026-09-08', 'FIRST'); // floor se pehle
    r = await selfIn(A, '2026-09-08', '16:10');
    check('floor se pehle FIRST-half, 16:10 aaya → PRESENT, koi row nahi', r.status === 'PRESENT' && !(await lateRow(A._id, '2026-09-08')));
  }

  console.log('\nPART B6 — half-day: check-in pehle, leave BAAD me approve, phir cancel');
  {
    // Full din samajh kar 14:40 par aaya → −2. Phir first-half leave approve → afternoon → −1. Cancel → phir −2.
    await selfIn(A, '2026-09-29', '14:40');
    let row = await lateRow(A._id, '2026-09-29');
    check('14:40 check-in (abhi full din) → −2', row?.points === -2, rowStr(row));
    setClock(at('2026-09-29', '15:00'));
    const lr = await leave.applyLeave(A, { type: 'SICK', startYMD: '2026-09-29', endYMD: '2026-09-29', halfDay: true, halfDayPart: 'FIRST', reason: 't' });
    await leave.decideLeave(boss, lr.id || lr._id, 'APPROVE', '');
    let r = await rec(A._id, '2026-09-29');
    row = await lateRow(A._id, '2026-09-29');
    check('FIRST-half approve hua → status LATE (afternoon), row −1 "(afternoon half)"', r.status === 'LATE' && r.halfDayLeave && row?.points === -1 && /afternoon half/.test(row.reason), `${r.status} ${rowStr(row)}`);
    // Second-half leave over a 10:40 check-in → morning worked → PRESENT, row gone
    await selfIn(A, '2026-09-30', '10:40');
    check('30 Sep 10:40 → −1 pehle', (await lateRow(A._id, '2026-09-30'))?.points === -1);
    setClock(at('2026-09-30', '12:00'));
    const lr2 = await leave.applyLeave(A, { type: 'SICK', startYMD: '2026-09-30', endYMD: '2026-09-30', halfDay: true, halfDayPart: 'SECOND', reason: 't' });
    await leave.decideLeave(boss, lr2.id || lr2._id, 'APPROVE', '');
    check('SECOND-half approve → PRESENT, row gayab (subah ka half kabhi late nahi)', (await rec(A._id, '2026-09-30')).status === 'PRESENT' && !(await lateRow(A._id, '2026-09-30')));
    // Cancel the FIRST-half leave of 29 Sep → full day again → −2
    const boss2 = await User.create({ name: 'Boss2', email: 'b2@t.co', passwordHash: 'x', role: 'CEO_PRESIDENT', employeeId: 'R-B2', isActive: true, joinedAt: new Date('2025-01-01') });
    await leave.cancelLeave(boss2, lr.id || lr._id);
    r = await rec(A._id, '2026-09-29');
    row = await lateRow(A._id, '2026-09-29');
    check('leave cancel → flag hata, full din: LATE −2 wapas', r.status === 'LATE' && !r.halfDayLeave && row?.points === -2 && !/afternoon/.test(row.reason), `${r.status} ${rowStr(row)}`);
  }

  console.log('\nPART B7 — backfillMonth (mahine ka dobara hisab) — sab rows ko wahi dena chahiye jo live raaste ne diya');
  {
    const before = await PointEntry.find({ source: 'auto_late' }).sort({ dedupeKey: 1 }).lean();
    setClock(at('2026-10-05', '10:00'));
    await backfillMonth('2026-09');
    const after = await PointEntry.find({ source: 'auto_late' }).sort({ dedupeKey: 1 }).lean();
    const same = before.length === after.length && before.every((b, i) => b.dedupeKey === after[i].dedupeKey && b.points === after[i].points && b.reason === after[i].reason);
    check(`backfill ne kuch nahi badla (${before.length} rows waise ki waisi)`, same, same ? '' : JSON.stringify(after.map((r) => [r.dedupeKey.slice(-10), r.points]), null, 0));
    // Ek row mita kar backfill → wahi rung wapas likhe
    await PointEntry.deleteMany({ dedupeKey: `auto_late:${A._id}:2026-09-25` });
    await backfillMonth('2026-09');
    const row = await lateRow(A._id, '2026-09-25');
    check('mitaayi hui afternoon −3 row backfill ne wapas likhi', row?.points === -3 && /afternoon half/.test(row.reason), rowStr(row));
    // Excused row ko backfill wapas na laaye
    await backfillMonth('2026-09');
    const ex = await rec(A._id, '2026-09-16');
    await att.excuseLate(boss, ex._id, true);
    await backfillMonth('2026-09');
    check('excused din ki row backfill ke baad bhi nahi', !(await lateRow(A._id, '2026-09-16')));
  }

  console.log('\nPART B8 — today payload (card ke liye marks)');
  {
    setClock(at('2026-10-06', '09:00'));
    let p = await att.getTodayPayload(A);
    check('normal din: 2 marks (10:16, 11:00 IST), lateArrivalPoints 1', p.lateMarks.length === 2 && p.lateMarks[0] === at('2026-10-06', '10:16').toISOString() && p.lateMarks[1] === at('2026-10-06', '11:00').toISOString() && p.lateArrivalPoints === 1 && p.afternoonHalf === false, JSON.stringify(p.lateMarks));
    await halfLeave(A, '2026-10-07', 'FIRST');
    setClock(at('2026-10-07', '09:00'));
    p = await att.getTodayPayload(A);
    check('FIRST-half leave din: 4 marks (14:00 … 17:00), afternoonHalf true', p.lateMarks.length === 4 && p.lateMarks[0] === at('2026-10-07', '14:00').toISOString() && p.afternoonHalf === true, JSON.stringify(p.lateMarks));
    setClock(at('2026-10-11', '09:00')); // Sunday
    p = await att.getTodayPayload(A);
    check('off day: koi mark nahi', p.lateMarks.length === 0);
    p = await att.getTodayPayload(N);
    check('part-timer Sunday: marks 18:00, 19:00', p.lateMarks.length === 2 && p.lateMarks[0] === at('2026-10-11', '18:00').toISOString());
  }

  console.log('\nPART B9 — Rules page: text migrate + viewer ke apne time');
  {
    const res = { json(body) { this.body = body; return this; }, status() { return this; } };
    await rules.list({ user: A }, res, (e) => { throw e; });
    const texts = (res.body?.data?.sections || res.body?.data || []).flatMap((s) => (s.rules || []).map((r) => r.text));
    const late = texts.find((t) => /counts as LATE and cuts/.test(t)) || '';
    const aft = texts.find((t) => /AFTERNOON half/.test(t)) || '';
    check('late rule 10–6 viewer: "after 11:00 AM", "−2 in all", "13 September 2026"', /after 11:00 AM/.test(late) && /−2 in all/.test(late) && /13 September 2026/.test(late), late.slice(0, 160));
    check('afternoon rule 10–6 viewer: "2:00 PM sharp", marks "3:00 PM, 4:00 PM, 5:00 PM"', /due at 2:00 PM sharp/.test(aft) && /3:00 PM, 4:00 PM, 5:00 PM/.test(aft), aft.slice(0, 160));
    check('purana late text ab kahin nahi', !texts.some((t) => /counts as LATE\. Each late arrival/.test(t)));
    const resK = { json(body) { this.body = body; return this; }, status() { return this; } };
    await rules.list({ user: K }, resK, (e) => { throw e; });
    const textsK = (resK.body?.data?.sections || resK.body?.data || []).flatMap((s) => (s.rules || []).map((r) => r.text));
    check('11–8 viewer: "after 12:00 PM"; afternoon "3:30 PM sharp", marks "4:30 PM, 5:30 PM, 6:30 PM, 7:30 PM"', /after 12:00 PM/.test(textsK.find((t) => /counts as LATE and cuts/.test(t)) || '') && /due at 3:30 PM sharp/.test(textsK.find((t) => /AFTERNOON half/.test(t)) || '') && /4:30 PM, 5:30 PM, 6:30 PM, 7:30 PM/.test(textsK.find((t) => /AFTERNOON half/.test(t)) || ''));
    check('rulesTextVersion 7 stamp', (await Setting.findOne({ key: 'global' }).select('rulesTextVersion').lean()).rulesTextVersion === 7);
    check('RuleSection me late rule ek hi baar (duplicate nahi)', (await RuleSection.find().lean()).flatMap((s) => s.rules).filter((r) => /AFTERNOON half/.test(r.text)).length === 1);
  }

  console.log(`\n${failures ? `❌ ${failures} check(s) FAIL` : '✅ sab checks pass'}\n`);
  globalThis.Date = RealDate;
  await mongoose.connection.dropDatabase();
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await disconnectDB(); } catch { /* */ } process.exit(1); });
