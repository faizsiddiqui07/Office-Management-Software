/**
 * Streak ke award theek hain ya nahi — sirf PADHTA hai, kuch badalta nahi.
 *
 * Niyam ko khud dobara chala kar dekhta hai ki DB me jitne punctual-streak award hain,
 * theek utne hi hone chahiye — na ek zyada, na ek kam. `fix-checkin.js --rescan-streak`
 * ke baad ye chala kar tasalli kar lo.
 *
 *   node scripts/verify-streaks.js
 *   node scripts/verify-streaks.js --db office_ui_demo
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Attendance } from '../src/models/Attendance.js';
import { LeaveRequest } from '../src/models/LeaveRequest.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { holidayYMDSet } from '../src/services/holiday.service.js';
import { userWeekendDays } from '../src/lib/schedule.js';
import { periodStartFor } from '../src/lib/joining.js';
import { isBirthdayYMD } from '../src/lib/birthday.js';
import { ymdInTz, companyDayFromYMD, dayOfWeekInTz } from '../src/lib/time.js';
import { can } from '../src/lib/permissions.js';
import { loadRoles } from '../src/lib/roles.js';
import { APP_LIVE_YMD } from '../src/lib/appLive.js';

const dbFlag = process.argv.indexOf('--db');
if (dbFlag > -1 && process.argv[dbFlag + 1]) process.env.MONGODB_DB = process.argv[dbFlag + 1];
await connectDB();
await loadRoles(); // warna `can()` fallback par chala jaata hai aur roster galat ban'ta hai
console.log('Database:', mongoose.connection.name);
const s = await Setting.getFullSingleton();
const STREAK_LEN = 6;
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const yesterday = addDays(ymdInTz(new Date()), -1);

const holSet = await holidayYMDSet(APP_LIVE_YMD, yesterday);

const roster = (await User.find({ isActive: true }).select('name role employmentType schedule dateOfJoining dateOfBirth'))
  .filter((u) => can({ role: u.role }, 'markAttendance'));
const recs = await Attendance.find({ date: { $gte: companyDayFromYMD(APP_LIVE_YMD), $lte: companyDayFromYMD(yesterday) } }).select('user date status excused halfDayLeave');
const byUserDay = new Map(recs.map((r) => [`${r.user}|${ymdInTz(r.date)}`, r]));
const leaves = await LeaveRequest.find({ status: 'APPROVED' }).select('user startYMD endYMD');
const awards = await PointEntry.find({ source: 'auto_streak' }).select('user earnedYMD points');
const inDb = new Map();
for (const a of awards) inDb.set(`${a.user}|${a.earnedYMD}`, a.points);

let mismatches = 0;
const expected = new Set();

for (const u of roster) {
  const uid = String(u._id);
  const start = periodStartFor(u, APP_LIVE_YMD);
  const off = userWeekendDays(u, s);
  let count = 0;
  for (let d = start; d <= yesterday; d = addDays(d, 1)) {
    const dow = dayOfWeekInTz(companyDayFromYMD(d));
    if (off.includes(dow) || holSet.has(d) || isBirthdayYMD(u, d)) continue;
    const rec = byUserDay.get(`${uid}|${d}`);
    const onLeave = leaves.some((l) => String(l.user) === uid && l.startYMD <= d && l.endYMD >= d);
    if (rec && (rec.status === 'WFH' || rec.status === 'ON_LEAVE')) continue;
    if (rec && rec.status === 'LATE' && !rec.excused && !rec.halfDayLeave) { count = 0; continue; }
    if (!rec || rec.status === 'ABSENT') { if (onLeave) continue; count = 0; continue; }
    count += 1;
    if (count >= STREAK_LEN) { expected.add(`${uid}|${d}`); count = 0; }
  }
}

// milao
const extra = [...inDb.keys()].filter((k) => !expected.has(k));
const missing = [...expected].filter((k) => !inDb.has(k));
const nameOf = new Map(roster.map((u) => [String(u._id), u.name]));
console.log(`\nDB me awards: ${inDb.size}   |   niyam se banne chahiye: ${expected.size}`);
console.log(`Zyada (DB me hai par banna nahi chahiye): ${extra.length}`);
extra.forEach((k) => { const [u, d] = k.split('|'); console.log('   ', nameOf.get(u) || u, d); mismatches += 1; });
console.log(`Kam (banna chahiye par DB me nahi): ${missing.length}`);
missing.forEach((k) => { const [u, d] = k.split('|'); console.log('   ', nameOf.get(u) || u, d); mismatches += 1; });
console.log(mismatches ? '\n❌ farak hai — upar dekho' : '\n✅ DB ke award theek niyam ke mutabik hain');
await mongoose.disconnect();
