import { can } from '../lib/permissions.js';
import { ymdInTz } from '../lib/time.js';
import { userWeekendDays, workWindowClosed } from '../lib/schedule.js';
import { periodStartFor } from '../lib/joining.js';
import { isBirthdayYMD } from '../lib/birthday.js';
import { holidayYMDSet } from './holiday.service.js';

/**
 * EK WINDOW KE HAR DIN KI ROW — asli Attendance row ho ya na ho.
 *
 * KYUN: Attendance collection me SIRF un dinon ki row banti hai jab kuch hua ho —
 * koi check-in kare, leadership leave likhe, ya WFH declare ho. Sunday, company
 * holiday, aur "koi aaya hi nahi" wale din ka koi document kabhi nahi banta.
 * (Naapa: 725 rows wale DB me ABSENT = 0, HOLIDAY = 0.) Isliye jo screen seedhi
 * rows chhapti hai wo aise din dikha hi nahi sakti — chahe wo kitni bhi der dekhe.
 *
 * YE CODE NAYA NAHI HAI: ye dossier.service.js ka day-loop hai, wahan se nikaal kar
 * yahan laya gaya. Team-member page (users/[id]) pehle se isi se chalta hai. Dono
 * jagah se ek hi helper bulane ka matlab ye hai ki "mera attendance" aur "kisi aur
 * ka attendance" kabhi alag jawab nahi de sakte — pehle wo do alag raaste the.
 *
 * KUCH BHI STORE NAHI HOTA. Weekly-off/holiday ka nishaan row par likhna galat hota:
 * Settings me weekend badlo ya holiday calendar sudharo, to likha hua purana sach
 * patthar ban kar reh jata. (Attendance.js par `offDayWork` ke saath yahi behes
 * likhi hai — wo nishaan JAAN-BOOJH kar stamp hota hai, kyunki overtime ka paisa
 * us par tika hai. Yahan sirf dikhane ki baat hai, isliye har baar taaza gina jata hai.)
 *
 * @param {object} p.user           jiska calendar banana hai (role aur schedule chahiye)
 * @param {Array}  p.records        us window ki asli Attendance rows (Mongoose docs)
 * @param {string} p.fromYMD        'YYYY-MM-DD'
 * @param {string} p.toYMD          'YYYY-MM-DD' — aaj se aage nahi badhaya jata
 * @param {object} p.settings       Setting singleton
 * @param {Date}   [p.now]
 * @returns {Promise<Array>} naye se purane kram me, har row par `dateYMD`
 */
export async function buildAttendanceDays({ user, records, fromYMD, toYMD, settings, now = new Date() }) {
  const asRow = (r) => ({
    id: r.id,
    dateYMD: ymdInTz(r.date),
    // Asli row par `date` waisa ka waisa rehta hai. Purani screens isi par sort/format
    // karti hain, aur unhe badalna is fix ke daayre se bahar hai.
    date: r.date,
    checkInAt: r.checkInAt,
    checkOutAt: r.checkOutAt,
    checkInMeta: r.checkInMeta,
    checkOutMeta: r.checkOutMeta,
    workedMinutes: r.workedMinutes || 0,
    overtimeMinutes: r.overtimeMinutes || 0,
    status: r.status,
    excused: !!r.excused,
    lateReason: r.lateReason || null,
    halfDayLeave: !!r.halfDayLeave,
    halfDayPart: r.halfDayPart || null,
    wfhOfficeWide: !!r.wfhOfficeWide,
    offDayWork: !!r.offDayWork,
  });

  // Jo role attendance lagata hi nahi (leadership), uska "absent" ka hisaab hota hi
  // nahi — uske liye sirf uski apni rows. Wahi niyam dossier me hai.
  const tracksAttendance = can({ role: user.role }, 'markAttendance');

  // Joining se pehle (ya app live hone se pehle) ka din kisi ka absent nahi hota.
  const countFrom = periodStartFor(user, fromYMD);
  // Aane wale din ka faisla nahi hota — aaj tak hi.
  const today = ymdInTz(now);
  const cappedTo = toYMD < today ? toYMD : today;

  if (!tracksAttendance || countFrom > cappedTo) return records.map(asRow);

  const holidays = await holidayYMDSet(countFrom, cappedTo);
  const weekend = userWeekendDays(user, settings);
  const recByYmd = new Map(records.map((r) => [ymdInTz(r.date), r]));

  const days = [];
  let cur = new Date(`${countFrom}T00:00:00.000Z`);
  const end = new Date(`${cappedTo}T00:00:00.000Z`);
  while (cur.getTime() <= end.getTime()) {
    const ymd = cur.toISOString().slice(0, 10);
    const rec = recByYmd.get(ymd);
    if (rec) {
      days.push(asRow(rec));
    } else {
      const dow = cur.getUTCDay();
      // Bina check-in wala kaam ka din TABHI "absent" hai jab us bande ki apni shift
      // khatam ho chuki ho — aaj subah 9 baje nahi. Warna har koi pahunchne se pehle
      // laal dikhta. Wahi guard company report aur daily roster me bhi hai.
      const status = holidays.has(ymd)
        ? 'HOLIDAY'
        : isBirthdayYMD(user, ymd)
          ? 'BIRTHDAY' // apna din — kabhi absent nahi
          : weekend.includes(dow)
            ? 'WEEKEND'
            : workWindowClosed(user, ymd, settings, now)
              ? 'ABSENT'
              : 'UPCOMING';
      days.push({
        id: `d-${ymd}`,
        dateYMD: ymd,
        date: null,
        checkInAt: null,
        checkOutAt: null,
        checkInMeta: null,
        checkOutMeta: null,
        workedMinutes: 0,
        overtimeMinutes: 0,
        status,
        excused: false,
        lateReason: null,
        halfDayLeave: false,
        halfDayPart: null,
        wfhOfficeWide: false,
        offDayWork: false,
      });
    }
    cur = new Date(cur.getTime() + 86400000);
  }

  // Window me aage ki tareekh ki ASLI row (jaise approve ho chuki leave, ya pehle se
  // declare ki hui office-wide WFH) bhi dikhni chahiye. Upar wala loop `cappedTo` par
  // ruk jata hai — wo sahi hai, kyunki aane wale khaali din ko ABSENT batana jhooth
  // hoga. Par jiske paas asli row hai use chhupana bhi jhooth hai.
  for (const r of records) {
    const ymd = ymdInTz(r.date);
    if (ymd > cappedTo) days.push(asRow(r));
  }

  days.sort((a, b) => (a.dateYMD < b.dateYMD ? 1 : a.dateYMD > b.dateYMD ? -1 : 0)); // naya pehle
  return days;
}
