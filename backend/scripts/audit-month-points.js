/**
 * Ek mahine ka points-audit — sirf PADHTA hai, kuch badalta nahi.
 *
 *   node scripts/audit-month-points.js --month 2026-09
 *   node scripts/audit-month-points.js --month 2026-09 --db office_ui_demo
 *
 * Har bande ke liye niyam khud dobara chala kar batata hai ki kya BANNA chahiye, aur
 * phir DB se milata hai ki kya MILA. Teen cheezein dekhta hai:
 *
 *   1. Punctual streak  — 6 lagataar on-time din (chhutti/leave/WFH neutral, excused
 *                         late on-time ginta hai)
 *   2. Perfect attendance — poore mahine na koi gair-hazri na koi bina-bataye late
 *   3. Late ka jurmana  — excused (on-duty) din par jurmana nahi lagna chahiye
 *
 * Yahi wo teen jagah hain jahan "26 tareekh ko ON_DUTY mark kiya" jaisa baad ka badlav
 * chup-chaap chhoot jaata hai, kyunki streak ka scan har din ko sirf ek baar dekhta hai
 * aur mahine ka faisla ek baar ho kar band ho jaata hai.
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
import { userWeekendDays, effectiveSchedule } from '../src/lib/schedule.js';
import { periodStartFor } from '../src/lib/joining.js';
import { isBirthdayYMD } from '../src/lib/birthday.js';
import { penaltyRungs } from '../src/lib/lateLadder.js';
import { ymdInTz, companyDayFromYMD, dayOfWeekInTz } from '../src/lib/time.js';
import { can } from '../src/lib/permissions.js';
import { loadRoles } from '../src/lib/roles.js';
import { APP_LIVE_YMD } from '../src/lib/appLive.js';

const flag = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null; };
const month = flag('month') || ymdInTz(new Date()).slice(0, 7);
if (flag('db')) process.env.MONGODB_DB = flag('db');
const STREAK_LEN = 6;
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };

await connectDB();
// Roles DB se aate hain. Inhe load kiye bina `can()` fallback par chala jaata hai aur roster
// 9 ke bajaye 14 dikhne lagta hai (un logon ki bhi ginti hone lagti hai jin par niyam lagta
// hi nahi) — tab report me jhoothi "koi record nahi" wali lines bhar jaati hain.
await loadRoles();
console.log(`\nDatabase: ${mongoose.connection.name}   |   Mahina: ${month}\n`);

const s = await Setting.getFullSingleton();
const b = s.bonus || {};
const rule = (k) => Number((b.autoRules || []).find((r) => r.key === k)?.points) || 0;
const streakPts = Math.abs(rule('punctualStreak'));
const perfectPts = Math.abs(rule('perfectAttendanceMonth'));
const latePts = Math.abs(rule('lateArrival'));
console.log(`Niyam: streak ${streakPts} | perfect month ${perfectPts} | late −${latePts} per rung`);
console.log(`Streak ka nishaan (lastStreakScan): ${b.lastStreakScan || '(koi nahi)'}\n`);

const from = `${month}-01`;
const to = monthEnd(month);
const today = ymdInTz(new Date());
const roster = (await User.find({ isActive: true }).select('name role employmentType schedule dateOfJoining dateOfBirth'))
  .filter((u) => can({ role: u.role }, 'markAttendance'));

// Streak ki ginti go-live se chalti hai (chain mahine ki seema nahi maanti), isliye poora
// itihaas padhna padta hai — par report sirf is mahine ki.
const recs = await Attendance.find({ date: { $gte: companyDayFromYMD(APP_LIVE_YMD), $lte: companyDayFromYMD(addDays(today, -1)) } })
  .select('user date status excused halfDayLeave halfDayPart checkInAt');
const byDay = new Map(recs.map((r) => [`${r.user}|${ymdInTz(r.date)}`, r]));
const leaves = await LeaveRequest.find({ status: 'APPROVED' }).select('user startYMD endYMD');
const hols = await holidayYMDSet(APP_LIVE_YMD, addDays(today, -1));
const points = await PointEntry.find({}).select('user month points source earnedYMD dedupeKey');

const rows = [];
for (const u of roster) {
  const uid = String(u._id);
  const off = userWeekendDays(u, s);
  const sched = effectiveSchedule(u, s);
  const neutral = (d) => off.includes(dayOfWeekInTz(companyDayFromYMD(d))) || hols.has(d) || isBirthdayYMD(u, d);

  // ── 1. streak: go-live se aaj tak chala kar is mahine ke award nikalo ──
  let count = 0;
  const shouldStreak = [];
  for (let d = periodStartFor(u, APP_LIVE_YMD); d <= addDays(today, -1); d = addDays(d, 1)) {
    if (neutral(d)) continue;
    const rec = byDay.get(`${uid}|${d}`);
    const onLeave = leaves.some((l) => String(l.user) === uid && l.startYMD <= d && l.endYMD >= d);
    if (rec && (rec.status === 'WFH' || rec.status === 'ON_LEAVE')) continue;
    if (rec && rec.status === 'LATE' && !rec.excused && !rec.halfDayLeave) { count = 0; continue; }
    if (!rec || rec.status === 'ABSENT') { if (onLeave) continue; count = 0; continue; }
    count += 1;
    if (count >= STREAK_LEN) { if (d >= from && d <= to) shouldStreak.push(d); count = 0; }
  }
  const gotStreak = points.filter((p) => String(p.user) === uid && p.source === 'auto_streak' && p.earnedYMD >= from && p.earnedYMD <= to).map((p) => p.earnedYMD).sort();

  // ── 2. perfect month ──
  let absent = 0;
  let lateBad = 0;
  let workingDays = 0;
  const startedOn = periodStartFor(u, from);
  const blemishes = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d < startedOn || neutral(d)) continue;
    workingDays += 1;
    const rec = byDay.get(`${uid}|${d}`);
    const onLeave = leaves.some((l) => String(l.user) === uid && l.startYMD <= d && l.endYMD >= d);
    if (!rec) { if (!onLeave) { absent += 1; blemishes.push(`${d.slice(8)} koi record nahi`); } }
    else if (rec.status === 'LATE' && !rec.excused) { lateBad += 1; blemishes.push(`${d.slice(8)} late`); }
    else if (rec.status === 'ABSENT') { absent += 1; blemishes.push(`${d.slice(8)} absent`); }
  }
  // Mahina khatam hone par hi faisla hota hai.
  const monthOver = to < today;
  const shouldPerfect = monthOver && workingDays > 0 && absent === 0 && lateBad === 0;
  const gotPerfect = points.some((p) => String(p.user) === uid && p.source === 'auto_perfect' && p.month === month);

  // ── 3. excused din par laga hua late jurmana ──
  const wrongLate = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const rec = byDay.get(`${uid}|${d}`);
    const owed = rec ? penaltyRungs(rec, companyDayFromYMD(d), sched).rungs : 0;
    const row = points.find((p) => String(p.user) === uid && p.source === 'auto_late' && p.earnedYMD === d);
    const have = row ? Math.abs(row.points) / (latePts || 1) : 0;
    if (have !== owed) wrongLate.push(`${d.slice(8)}: laga ${have} rung, banta ${owed}`);
  }

  rows.push({ name: u.name, shouldStreak, gotStreak, shouldPerfect, gotPerfect, workingDays, blemishes, wrongLate });
}

let issues = 0;
for (const r of rows.sort((a, b2) => a.name.localeCompare(b2.name))) {
  const sMiss = r.shouldStreak.filter((d) => !r.gotStreak.includes(d));
  const sExtra = r.gotStreak.filter((d) => !r.shouldStreak.includes(d));
  const pGap = r.shouldPerfect !== r.gotPerfect;
  const bad = sMiss.length || sExtra.length || pGap || r.wrongLate.length;
  if (bad) issues += 1;
  console.log(`${bad ? '⚠ ' : '  '}${r.name}`);
  console.log(`     streak  banta: [${r.shouldStreak.join(', ') || '—'}]   mila: [${r.gotStreak.join(', ') || '—'}]${sMiss.length ? `   ❌ CHHOOTA: ${sMiss.join(', ')}` : ''}${sExtra.length ? `   ❌ ZYADA: ${sExtra.join(', ')}` : ''}`);
  console.log(`     perfect banta: ${r.shouldPerfect ? 'HAAN' : 'nahi'}   mila: ${r.gotPerfect ? 'HAAN' : 'nahi'}${pGap ? '   ❌ FARAK' : ''}${!r.shouldPerfect && r.blemishes.length ? `   (wajah: ${r.blemishes.slice(0, 4).join(', ')}${r.blemishes.length > 4 ? ` +${r.blemishes.length - 4}` : ''})` : ''}`);
  if (r.wrongLate.length) console.log(`     late    ❌ ${r.wrongLate.join(' | ')}`);
}
console.log(`\n${issues ? `⚠ ${issues} logon me farak hai` : '✅ sab theek'}\n`);
await mongoose.disconnect();
