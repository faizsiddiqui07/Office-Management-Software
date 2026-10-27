/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * NIYAM: report ka "N working days" AAJ tak ginta hai, bilkul waise hi jaise uske saath
 * chhapne wala attendance rate aur employee ki apni report ginte hain.
 *
 * Pehle wo "aakhri POORA ho chuka office din" tak ginta tha, yaani office band hone (18:00)
 * se pehle KAL tak. Isse report khud se ulat ho jaati thi: 27 Oct 2026 ko subah 10 baje
 * header "20 working days" dikhata tha, jabki uske bagal me chhapa 91% rate har bande ke
 * apne 21 din se bana tha, aur usi bande ki apni report bhi 21 kehti thi. Owner ne pakda.
 *
 * GAIR-HAAZRI (absent) ki apni, sakht khidki waisi hi rehni chahiye: jo din abhi chal raha
 * hai usme kisi ko absent nahi likha jaata. Wo bhi yahan jaancha jaata hai.
 *
 * Ghadi nahi chhedi jaati — `workEnd` badal kar "office khula" / "office band" banaya
 * jaata hai, kyunki code wahi shart dekhta hai.
 *
 * Run (backend folder se):  node scripts/test-report-working-days.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_reportwd'; // throwaway DB
process.env.APP_LIVE_YMD = '2020-01-01'; // puraani tareekhein bhi gini ja sakein

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Holiday } from '../src/models/Holiday.js';
import { Attendance } from '../src/models/Attendance.js';
import { loadRoles } from '../src/lib/roles.js';
import { companyDayFromYMD, ymdInTz } from '../src/lib/time.js';
import { buildReport, buildSelfReport, computePeriod } from '../src/services/report.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}

const dow = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const addDays = (ymd, n) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
/** Seedhi-saadi ginti, service se bilkul alag likhi — tabhi ye jaanch ka kaam karti hai. */
function countPlain(from, to, holidays) {
  if (to < from) return 0;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (dow(d) !== 0 && !holidays.has(d)) n += 1;
  return n;
}
/** Office khula (18:00 abhi door) ya band — ghadi ki jagah `workEnd` se. */
const setOffice = async (state) => {
  await Setting.updateOne({ key: 'global' }, { $set: { workEnd: state === 'open' ? '23:59' : '00:00' } });
  Setting.invalidateCache();
};

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO & President', rank: 0, permissions: [], isSystem: true },
    { key: 'TEAM', label: 'Team', rank: 40, permissions: ['markAttendance', 'applyLeave'], isSystem: true },
  ]);
  await loadRoles();
  await Setting.create({ key: 'global', companyName: 'TestCo', weekendDays: [0], workStart: '10:00', workEnd: '18:00' });
  Setting.invalidateCache();

  const today = ymdInTz(new Date());
  const yest = addDays(today, -1);
  const monthFrom = `${today.slice(0, 7)}-01`;
  console.log(`Aaj: ${today} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow(today)]}) | mahina ${monthFrom} se\n`);

  const asha = await User.create({
    name: 'Asha', email: 'a@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'R-A',
    isActive: true, dateOfJoining: new Date('2024-01-01T00:00:00Z'),
  });

  // Ek chhutti mahine ke andar, kisi NON-Sunday din par jo aaj se pehle ho — bilkul waisi
  // jaisi asli October me thi (2 Oct Gandhi Jayanti, 20 Oct Dussehra).
  const holidays = new Set();
  for (let d = monthFrom; d < today; d = addDays(d, 1)) {
    if (dow(d) !== 0) {
      await Holiday.create({ title: 'Test chhutti', type: 'HOLIDAY', startYMD: d, endYMD: d, startDate: new Date(`${d}T00:00:00Z`), endDate: new Date(`${d}T00:00:00Z`) });
      holidays.add(d);
      break;
    }
  }
  console.log(`Chhutti daali: ${[...holidays].join(', ') || '(mahine ka pehla din hai, koi nahi)'}\n`);

  const expToday = countPlain(monthFrom, today, holidays);
  const expYest = countPlain(monthFrom, yest >= monthFrom ? yest : monthFrom, holidays);

  console.log('PART 1 — office KHULA (aaj ka din abhi chal raha hai)');
  await setOffice('open');
  {
    const r = await buildReport('monthly', today);
    check(`header working days = AAJ tak (${expToday})`, r.workingDays === expToday, `mila ${r.workingDays}`);
    if (dow(today) !== 0 && !holidays.has(today)) {
      check('…yaani kal se ek zyada (purana code kal par rukta tha)', r.workingDays === expYest + 1, `aaj ${r.workingDays} vs kal ${expYest}`);
    }
    const per = r.attendance.perEmployee.find((e) => e.name === 'Asha');
    check('header aur bande ke apne working days ab BARABAR', r.workingDays === per.workingDays,
      `header ${r.workingDays} vs row ${per.workingDays}`);
    check('asOfYMD aaj hai', r.asOfYMD === today, r.asOfYMD);
    check('absentAsOfYMD abhi bhi KAL (gair-haazri ka apna sakht niyam)', r.absentAsOfYMD === yest, r.absentAsOfYMD);
  }

  console.log('\nPART 2 — self report company se mel khaye (yahi invariant toota tha)');
  {
    const r = await buildReport('monthly', today);
    const self = await buildSelfReport({ user: asha, type: 'monthly', dateYMD: today });
    check('self ka working days == company ka header', self.attendance.totals.workingDays === r.workingDays,
      `self ${self.attendance.totals.workingDays} vs company ${r.workingDays}`);
  }

  console.log('\nPART 3 — rate ka denominator header se mel khaye');
  {
    // Asha har working day aayi (aaj samet) → rate poora 100% hona chahiye, aur wo tabhi
    // banta hai jab numerator aur denominator ek hi din ginein.
    for (let d = monthFrom; d <= today; d = addDays(d, 1)) {
      if (dow(d) === 0 || holidays.has(d)) continue;
      await Attendance.create({ user: asha._id, date: companyDayFromYMD(d), status: 'PRESENT', workedMinutes: 480 });
    }
    const r = await buildReport('monthly', today);
    const per = r.attendance.perEmployee.find((e) => e.name === 'Asha');
    check(`har working day aayi → present = ${expToday}`, per.present === expToday, `mila ${per.present}`);
    check('rate 100% (numerator aur denominator ek hi khidki)', r.attendance.totals.attendanceRate === 100,
      `${r.attendance.totals.attendanceRate}%`);
    check('aaj ki haazri ginti me hai par koi absent nahi', per.absent === 0, `absent=${per.absent}`);
  }

  console.log('\nPART 4 — office BAND hone par number badalna nahi chahiye');
  {
    const open = await buildReport('monthly', today);
    await setOffice('closed');
    const closed = await buildReport('monthly', today);
    check('working days dono haalat me ek hi', open.workingDays === closed.workingDays,
      `khula ${open.workingDays} vs band ${closed.workingDays}`);
    check('band hone par hi absentAsOfYMD aaj hota hai', closed.absentAsOfYMD === today, closed.absentAsOfYMD);
    await setOffice('open');
  }

  console.log('\nPART 5 — guzra hua mahina (poora gina jaaye, aaj se koi lena-dena nahi)');
  {
    const prevAnchor = addDays(monthFrom, -1); // pichhle mahine ka aakhri din
    const p = computePeriod('monthly', prevAnchor);
    const r = await buildReport('monthly', prevAnchor);
    check(`pichhla mahina poora gina (${p.from} se ${p.to})`, r.workingDays === countPlain(p.from, p.to, new Set()),
      `mila ${r.workingDays}, aasha ${countPlain(p.from, p.to, new Set())}`);
    check('guzre mahine me asOfYMD = us mahine ka aakhri din', r.asOfYMD === p.to, r.asOfYMD);
  }

  console.log('\nPART 6 — aage ka mahina (abhi shuru hi nahi hua)');
  {
    const nextAnchor = `${addDays(`${today.slice(0, 7)}-28`, 10).slice(0, 7)}-15`;
    const r = await buildReport('monthly', nextAnchor);
    check('aane wale mahine ke 0 working days', r.workingDays === 0, String(r.workingDays));
    check('…aur rate null (0% nahi — sawaal ka jawab hai hi nahi)', r.attendance.totals.attendanceRate === null,
      String(r.attendance.totals.attendanceRate));
  }
}

main()
  .then(async () => {
    console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PAAS'}`);
    if (mongoose.connection.name === 'office_test_reportwd') await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(failures ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(e);
    if (mongoose.connection.name === 'office_test_reportwd') await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(1);
  });
