/**
 * "Kya ye din is bande ke liye chhutti ka tha?" — ek hi jagah, sync.
 *
 * KYUN ALAG FILE. `attendance.service.js` ka `isOffDayFor` async hai: wo har call par ek
 * poora `Holiday.find` maarta hai. Overtime ka hisaab `computeWork` me hota hai jo sync hai,
 * aur `recomputeAllOvertime` jaise raaste hazaaron record par loop karte hain — wahan per-record
 * DB query Lambda ke 30 second me nahi samati. Isliye faisla sync hai aur holiday ka set
 * BAAHAR se aata hai (range ka ek hi `holidayYMDSet`). Bilkul wahi dhancha jo
 * report.service.js pehle se use karta hai.
 *
 * Teen shart — wahi teen jo `isOffDayFor` me hain, taaki "jis din late nahi lagti" aur "jis
 * din poora din overtime milta hai" kabhi alag na ho jayein:
 *   1. company holiday (Holiday collection)
 *   2. us bande ka apna weekly off (uska `schedule.workDays`, warna office ka weekend)
 *   3. us bande ka apna janamdin  — owner ka faisla 12 Oct 2026: ye bhi shaamil hai
 *
 * Sirf lib se import karta hai (schedule, time, birthday) — kisi service se nahi, taaki
 * circular import ka sawaal hi na uthe.
 */
import { userWeekendDays } from './schedule.js';
import { dayOfWeekInTz, companyDayFromYMD } from './time.js';
import { isBirthdayYMD } from './birthday.js';

/**
 * @param {object} user         user doc — `schedule` aur `dateOfBirth` chahiye
 * @param {string} ymd          'YYYY-MM-DD'
 * @param {object} settings     Setting singleton (office ka weekendDays)
 * @param {Set}    holidaySet   is range ka company-holiday set, pehle se load kiya hua
 */
export function isOffDaySync(user, ymd, settings, holidaySet) {
  if (holidaySet && holidaySet.has(ymd)) return true;
  if (userWeekendDays(user, settings).includes(dayOfWeekInTz(companyDayFromYMD(ymd)))) return true;
  return isBirthdayYMD(user, ymd);
}
