/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * "ATTENDANCE HISTORY ME SUNDAY / HOLIDAY / ABSENT BHI DIKHE" (owner, 19 Nov 2026).
 *
 * PEHLE KYA THA: Attendance collection me SIRF un dinon ki row banti hai jab kuch hua
 * ho — koi check-in kare, leadership leave likhe, ya WFH declare ho. Sunday, company
 * holiday, aur "koi aaya hi nahi" wale din ka koi document kabhi nahi banta. Naapa gaya:
 * asli jaise 725 rows wale DB me PRESENT 490, LATE 189, ON_LEAVE 38, WFH 8 — aur
 * ABSENT 0, HOLIDAY 0. Yaani wo do enum value practically mari hui hain.
 *
 * To "meri attendance" wali table, jo seedhi rows chhapti thi, aise din dikha hi nahi
 * sakti thi. Team-member page (dossier) ye calendar PEHLE SE dikhata tha — par apne hi
 * code se. Ab dono services/attendanceDays.service.js se aate hain.
 *
 * YAHAN KYA SABIT HOTA HAI:
 *   A. buildAttendanceDays har din bharta hai, sahi status ke saath
 *   B. aane wale din ko ABSENT nahi batata, aur AAJ ko shift khatam hone se pehle nahi
 *   C. joining se pehle ke din kisi ke absent nahi
 *   D. part-timer ke apne off-days (weekend) uske hisaab se lagte hain
 *   E. window me padi AAGE ki asli row (approve ho chuki leave) gayab nahi hoti
 *   F. listAttendance: bina `fill` ke jawab BILKUL waisa ka waisa (CSV/Everyone tab)
 *   G. listAttendance: har row par `dateYMD` — aur wo ISO slice se EK DIN alag hai
 *   H. dossier wahi din deta hai jo nayi history deti hai (dono ek hi helper se)
 *
 * Run (backend folder se):  node scripts/test-attendance-days.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_attdays'; // throwaway DB

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Role } from '../src/models/Role.js';
import { User } from '../src/models/User.js';
import { Setting } from '../src/models/Setting.js';
import { Attendance } from '../src/models/Attendance.js';
import { Holiday } from '../src/models/Holiday.js';
import { loadRoles } from '../src/lib/roles.js';
import { SYSTEM_ROLES } from '../src/lib/permissionCatalog.js';
import { companyDayFromYMD, companyDayInstantAt, ymdInTz } from '../src/lib/time.js';
import { buildAttendanceDays } from '../src/services/attendanceDays.service.js';
import { listAttendance } from '../src/services/attendance.service.js';
import { getUserDossier } from '../src/services/dossier.service.js';

const DB = 'office_test_attdays';
let failures = 0;
let total = 0;
function check(name, cond, extra = '') {
  total += 1;
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function section(title, fn) {
  console.log(`\n${title}`);
  try { await fn(); } catch (e) { check(`${title} — crash`, false, e?.stack || e?.message); }
}

/** Har din ka status, 'YYYY-MM-DD' -> STATUS. Padhne me aasan. */
const byDay = (days) => Object.fromEntries(days.map((d) => [d.dateYMD, d.status]));

async function main() {
  await connectDB();
  if (!/test/i.test(mongoose.connection.name || '')) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${mongoose.connection.name}`);

  // Is office jaise role: owner CEO_PRESIDENT, koi CEO/DIRECTOR nahi.
  const LEAD = SYSTEM_ROLES.find((r) => r.key === 'CEO').permissions;
  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO & President', rank: 1, permissions: LEAD },
    { key: 'TEAM', label: 'Team', rank: 10, permissions: ['markAttendance', 'applyLeave'] },
  ]);
  await loadRoles();

  // weekendDays [0] = Sunday chhutti — asli office ki tarah.
  await Setting.create({
    key: 'global', companyName: 'TestCo', weekendDays: [0], workStart: '10:00', workEnd: '18:00',
    graceMinutes: 16, overtimeAfterMinutes: 60, annualLeaveQuota: 18, rolesSchemaVersion: 2,
  });
  Setting.invalidateCache();
  const settings = await Setting.getSingleton();

  // Nov 2026: 1 Sun, 8 Sun, 15 Sun, 22 Sun, 29 Sun.
  const asha = await User.create({
    name: 'Asha', email: 'asha@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'AD-1',
    isActive: true, dateOfJoining: new Date('2026-06-01T00:00:00+05:30'),
  });
  // Leadership — section J iske liye hai (uske absent nahi bante).
  await User.create({
    name: 'Owner', email: 'owner@t.co', passwordHash: 'x', role: 'CEO_PRESIDENT', employeeId: 'AD-0',
    isActive: true, dateOfJoining: new Date('2026-06-01T00:00:00+05:30'),
  });

  await Holiday.create({
    title: 'Test Holiday', type: 'HOLIDAY',
    startDate: companyDayFromYMD('2026-11-11'), endDate: companyDayFromYMD('2026-11-11'),
    startYMD: '2026-11-11', endYMD: '2026-11-11', createdBy: asha._id,
  });

  const mkRow = async (user, ymd, { status = 'PRESENT', inHM = '09:30', outHM = '18:30', worked = 480, ot = 0 } = {}) =>
    Attendance.create({
      user: user._id, date: companyDayFromYMD(ymd), status,
      checkInAt: inHM ? companyDayInstantAt(companyDayFromYMD(ymd), inHM) : null,
      checkOutAt: outHM ? companyDayInstantAt(companyDayFromYMD(ymd), outHM) : null,
      workedMinutes: worked, overtimeMinutes: ot,
    });

  await mkRow(asha, '2026-11-16');
  await mkRow(asha, '2026-11-17', { status: 'LATE', inHM: '10:45' });
  await mkRow(asha, '2026-11-18', { outHM: null, worked: 0 }); // check-out bhool gaye
  await mkRow(asha, '2026-11-12', { status: 'ON_LEAVE', inHM: null, outHM: null, worked: 0 });

  // "Abhi" = 19 Nov 2026, dopahar 3 baje. Shift 18:00 par khatam hoti hai, to AAJ abhi
  // chal raha hai — ye sabse nazuk haalat hai (B).
  const NOW = new Date('2026-11-19T15:00:00+05:30');

  await section('A — har din bharta hai, sahi status ke saath', async () => {
    const records = await Attendance.find({ user: asha._id }).sort({ date: -1 });
    const days = await buildAttendanceDays({
      user: asha, records, fromYMD: '2026-11-09', toYMD: '2026-11-19', settings, now: NOW,
    });
    const m = byDay(days);
    check('11 din bane (9–19 Nov)', days.length === 11, String(days.length));
    check('Sun 15 Nov = WEEKEND', m['2026-11-15'] === 'WEEKEND', m['2026-11-15']);
    check('Wed 11 Nov = HOLIDAY', m['2026-11-11'] === 'HOLIDAY', m['2026-11-11']);
    check('Thu 12 Nov = ON_LEAVE (asli row)', m['2026-11-12'] === 'ON_LEAVE', m['2026-11-12']);
    check('Fri 13 Nov = ABSENT (kaam ka din, koi aaya nahi)', m['2026-11-13'] === 'ABSENT', m['2026-11-13']);
    check('Sat 14 Nov = ABSENT (weekendDays me sirf Sunday hai)', m['2026-11-14'] === 'ABSENT', m['2026-11-14']);
    check('Mon 16 Nov = PRESENT', m['2026-11-16'] === 'PRESENT', m['2026-11-16']);
    check('Tue 17 Nov = LATE', m['2026-11-17'] === 'LATE', m['2026-11-17']);
    check('naya pehle (sorted desc)', days[0].dateYMD === '2026-11-19' && days[10].dateYMD === '2026-11-09',
      `${days[0].dateYMD} … ${days[10].dateYMD}`);
    const sun = days.find((d) => d.dateYMD === '2026-11-15');
    check('bharey hue din par 0 minute (StatCard ka jod na bigde)', sun.workedMinutes === 0 && sun.overtimeMinutes === 0, JSON.stringify([sun.workedMinutes, sun.overtimeMinutes]));
    check('…aur uski id takra na sake', sun.id === 'd-2026-11-15', sun.id);
  });

  await section('B — aaj abhi chal raha hai: ABSENT nahi, UPCOMING', async () => {
    const records = await Attendance.find({ user: asha._id }).sort({ date: -1 });
    const mid = await buildAttendanceDays({ user: asha, records, fromYMD: '2026-11-19', toYMD: '2026-11-19', settings, now: NOW });
    check('15:00 par aaj = UPCOMING', mid[0].status === 'UPCOMING', mid[0].status);
    // Wahi din, par shift khatam hone ke baad.
    const evening = new Date('2026-11-19T18:30:00+05:30');
    const late = await buildAttendanceDays({ user: asha, records, fromYMD: '2026-11-19', toYMD: '2026-11-19', settings, now: evening });
    check('18:30 par wahi din = ABSENT', late[0].status === 'ABSENT', late[0].status);
    // Aane wala din kabhi absent nahi.
    const ahead = await buildAttendanceDays({ user: asha, records, fromYMD: '2026-11-19', toYMD: '2026-11-25', settings, now: NOW });
    check('aane wale din bante hi nahi (19 tak hi)', ahead[0].dateYMD === '2026-11-19', ahead[0].dateYMD);
  });

  await section('C — joining se pehle ke din kisi ke absent nahi', async () => {
    const naya = await User.create({
      name: 'Naya', email: 'naya@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'AD-2',
      isActive: true, dateOfJoining: new Date('2026-11-16T00:00:00+05:30'),
    });
    const days = await buildAttendanceDays({ user: naya, records: [], fromYMD: '2026-11-09', toYMD: '2026-11-19', settings, now: NOW });
    check('16 Nov se pehle koi din nahi', days.every((d) => d.dateYMD >= '2026-11-16'), days.map((d) => d.dateYMD).join(','));
    check('16 Nov se aage bharey gaye', days.some((d) => d.dateYMD === '2026-11-16'), String(days.length));
  });

  await section('D — part-timer ke apne off-days', async () => {
    // Sirf Mon/Wed/Fri kaam karta hai → Tue/Thu/Sat/Sun uske weekend.
    const pt = await User.create({
      name: 'Partho', email: 'partho@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'AD-3',
      isActive: true, dateOfJoining: new Date('2026-06-01T00:00:00+05:30'),
      employmentType: 'PART_TIME', schedule: { workDays: [1, 3, 5], workStart: '10:00', workEnd: '14:00' },
    });
    const days = await buildAttendanceDays({ user: pt, records: [], fromYMD: '2026-11-16', toYMD: '2026-11-19', settings, now: NOW });
    const m = byDay(days);
    check('Mon 16 = ABSENT (uska kaam ka din)', m['2026-11-16'] === 'ABSENT', m['2026-11-16']);
    check('Tue 17 = WEEKEND (uska off)', m['2026-11-17'] === 'WEEKEND', m['2026-11-17']);
    check('Wed 18 = ABSENT (uska kaam ka din)', m['2026-11-18'] === 'ABSENT', m['2026-11-18']);
    // 19 Nov Thursday = uska off. Office walon ke liye wo kaam ka din hai — yahi farq
    // sabit karta hai ki hisaab US BANDE ka hai, office ka nahi.
    check('Thu 19 = WEEKEND (jabki Asha ke liye kaam ka din tha)', m['2026-11-19'] === 'WEEKEND', m['2026-11-19']);
  });

  await section('E — aage ki ASLI row gayab nahi hoti', async () => {
    // Approve ho chuki leave, jo aage ki tareekh ki hai. Purani table use dikhati thi
    // (wo seedhi rows chhapti thi), to naya raasta use chhupa de ye REGRESSION hoti.
    await mkRow(asha, '2026-11-24', { status: 'ON_LEAVE', inHM: null, outHM: null, worked: 0 });
    const records = await Attendance.find({ user: asha._id }).sort({ date: -1 });
    const days = await buildAttendanceDays({ user: asha, records, fromYMD: '2026-11-01', toYMD: '2026-11-30', settings, now: NOW });
    const m = byDay(days);
    check('24 Nov ki aage wali leave dikhti hai', m['2026-11-24'] === 'ON_LEAVE', String(m['2026-11-24']));
    check('…par 23 Nov (aage, khaali) bharaa nahi gaya', !('2026-11-23' in m), JSON.stringify(Object.keys(m).filter((k) => k > '2026-11-19')));
    check('aur sabse upar wahi aage wala din hai', days[0].dateYMD === '2026-11-24', days[0].dateYMD);
  });

  await section('F — bina `fill` ke jawab waisa ka waisa (CSV / Everyone tab)', async () => {
    const plain = await listAttendance(asha, { from: '2026-11-01', to: '2026-11-30', limit: 100 });
    const statuses = plain.records.map((r) => r.status).sort();
    check('sirf asli rows', plain.records.length === 5, String(plain.records.length));
    check('koi bhara hua din nahi', !statuses.includes('WEEKEND') && !statuses.includes('ABSENT'), statuses.join(','));
    check('total = asli rows ki ginti', plain.total === 5, String(plain.total));
  });

  await section('G — har row par `dateYMD`, aur wo ISO slice se ALAG hai', async () => {
    const plain = await listAttendance(asha, { from: '2026-11-18', to: '2026-11-18', limit: 10 });
    const r = plain.records[0];
    const sliced = new Date(r.date).toISOString().slice(0, 10);
    check('dateYMD sahi din deta hai', r.dateYMD === '2026-11-18', r.dateYMD);
    check('…jabki ISO ka slice EK DIN peechhe padhta hai', sliced === '2026-11-17', sliced);
    check('(yahi "Invalid Date" aur galat din wali jad thi)', r.dateYMD !== sliced, `${r.dateYMD} vs ${sliced}`);
  });

  await section('H — `fill` wala jawab: bharey din + sahi ginti', async () => {
    const filled = await listAttendance(asha, { from: '2026-11-09', to: '2026-11-19', limit: 100, fill: true });
    const m = byDay(filled.records);
    check('11 din (9–19 Nov)', filled.records.length === 11, String(filled.records.length));
    check('total bhi 11', filled.total === 11, String(filled.total));
    check('Sunday bhara', m['2026-11-15'] === 'WEEKEND', m['2026-11-15']);
    check('holiday bhara', m['2026-11-11'] === 'HOLIDAY', m['2026-11-11']);
    check('absent bhara', m['2026-11-13'] === 'ABSENT', m['2026-11-13']);
    check('har row par dateYMD', filled.records.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.dateYMD)), 'ok');

    // Page kaatne par `total` POORI window ki ginti rehni chahiye — table ke upar wali
    // "sirf itne dikh rahe hain" lakeer isi jodi par chalti hai.
    const page1 = await listAttendance(asha, { from: '2026-11-09', to: '2026-11-19', limit: 4, fill: true });
    check('limit 4 → 4 rows', page1.records.length === 4, String(page1.records.length));
    check('…par total phir bhi 11', page1.total === 11, String(page1.total));
    const page2 = await listAttendance(asha, { from: '2026-11-09', to: '2026-11-19', limit: 4, page: 2, fill: true });
    check('page 2 alag din deta hai', page2.records[0].dateYMD !== page1.records[0].dateYMD,
      `${page1.records[0].dateYMD} vs ${page2.records[0].dateYMD}`);
  });

  await section('I — dossier aur nayi history BILKUL ek jaisi (ek hi helper)', async () => {
    // Dono apne andar asli `new Date()` padhte hain, to dono ka "aaj" ek hi hai —
    // yahi is milaan ko imaandaar banata hai.
    const dossier = await getUserDossier(String(asha._id), { from: '2026-11-09', to: '2026-11-19' });
    const filled = await listAttendance(asha, { from: '2026-11-09', to: '2026-11-19', limit: 100, fill: true });
    const a = dossier.attendance.days.map((d) => `${d.dateYMD}:${d.status}`);
    const b = filled.records.map((d) => `${d.dateYMD}:${d.status}`);
    check('dono ne utne hi din diye', a.length === b.length, `${a.length} vs ${b.length}`);
    check('har din ka status hu-ba-hu same', same(a, b), a.length === b.length ? 'match' : `${a.slice(0, 3)} vs ${b.slice(0, 3)}`);
  });

  await section('J — jo role attendance lagata hi nahi, uske absent nahi bante', async () => {
    const boss = await User.findOne({ role: 'CEO_PRESIDENT' });
    const days = await buildAttendanceDays({ user: boss, records: [], fromYMD: '2026-11-09', toYMD: '2026-11-19', settings, now: NOW });
    check('leadership ke liye koi bhara hua din nahi', days.length === 0, String(days.length));
  });
}

main()
  .then(async () => {
    console.log(`\n${failures ? `❌ ${failures} / ${total} FAIL` : `✅ SAB PAAS — ${total} / ${total}`}`);
    if (mongoose.connection.name === DB) await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(failures ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(e);
    if (mongoose.connection.name === DB) await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(1);
  });
