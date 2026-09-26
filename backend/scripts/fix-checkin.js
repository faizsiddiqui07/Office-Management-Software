/**
 * Ek din ka check-in (ya check-out) theek karo — aur points ko uske saath theek karwao.
 *
 * Ye WAHI kaam karta hai jo app me "Attendance correction" approve karne par hota hai
 * (services/regularization.service.js → applyToAttendance): time badalta hai, late/present
 * ka faisla late-ladder se dobara karta hai, us din ka overtime dobara ginta hai, late ka
 * jurmana theek karta hai, gair-hazri ka jurmana hataata hai, aur mahine ka
 * perfect-attendance award dobara tay karta hai.
 *
 * PUNCTUAL STREAK alag cheez hai. Uska scan har din ko SIRF EK BAAR dekhta hai — kahan tak
 * dekh chuka hai wo `Setting.bonus.lastStreakScan` me likha rehta hai. Isliye purana din
 * theek karne se streak apne aap dobara nahi ginii jaati; `--rescan-streak` wo nishaan
 * hataa kar poori ginti go-live se dobara karwata hai (har award ki apni pakki key hai, to
 * jo award pehle ban chuke hain wo dubara nahi bante).
 *
 * Chalane ka tareeka (backend/ folder me):
 *
 *   # 1. Pehle bina kuch badle dekho — kya hoga
 *   node scripts/fix-checkin.js --user faiz --date 2026-09-18 --in 10:09
 *
 *   # 2. Theek lage to wahi hukm --apply ke saath
 *   node scripts/fix-checkin.js --user faiz --date 2026-09-18 --in 10:09 --apply
 *
 *   # 3. Streak bhi dobara ginwani ho (purana din badla ho tab zaroori)
 *   node scripts/fix-checkin.js --user faiz --date 2026-09-18 --in 10:09 --apply --rescan-streak
 *
 *   # Sirf streak dobara ginwani ho, kisi ka time na badalna ho
 *   node scripts/fix-checkin.js --rescan-streak --apply
 *
 * Aur options:
 *   --out 18:30      check-out bhi badlo (overtime dobara ginii jayegi)
 *   --db office_ui_demo   kisi aur database par (test ke liye)
 *   --reason "..."   activity log me kya likha jaye
 *
 * `--user` me naam ka hissa, email, ya employee ID — jo mile. Do log match huye to
 * script ruk jaati hai aur dono naam dikha deti hai.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Attendance } from '../src/models/Attendance.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { audit } from '../src/models/AuditLog.js';
import { effectiveSchedule } from '../src/lib/schedule.js';
import { judgeCheckIn, penaltyRungs } from '../src/lib/lateLadder.js';
import { companyDayFromYMD, companyDayInstantAt, ymdInTz, computeWork } from '../src/lib/time.js';
import {
  reconcileLatePenalty,
  clearAbsencePenalty,
  reconcilePerfectMonth,
  recomputeUserMonthOvertime,
  runRollingStreak,
} from '../src/services/bonus.service.js';

// ── hukm padho ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const has = (name) => argv.includes(`--${name}`);

const who = flag('user');
const dateYMD = flag('date');
const newIn = flag('in');
const newOut = flag('out');
const reason = flag('reason') || 'Corrected by script';
const dbName = flag('db');
const apply = has('apply');
const rescanStreak = has('rescan-streak');

const isYMD = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const isHM = (v) => /^\d{2}:\d{2}$/.test(String(v || ''));
const hm = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '—');
const line = (s = '') => console.log(s);

function usage(msg) {
  if (msg) console.error(`\n❌ ${msg}`);
  console.error('\nUsage:\n  node scripts/fix-checkin.js --user <naam|email|ID> --date YYYY-MM-DD --in HH:mm [--out HH:mm] [--apply] [--rescan-streak]');
  console.error('  node scripts/fix-checkin.js --rescan-streak --apply        (sirf streak dobara ginwao)\n');
  process.exit(2);
}

if (!who && !rescanStreak) usage('--user chahiye (ya sirf --rescan-streak chalao).');
if (who) {
  if (!isYMD(dateYMD)) usage('--date YYYY-MM-DD me do.');
  if (!newIn && !newOut) usage('--in ya --out me se kuch to do.');
  if (newIn && !isHM(newIn)) usage('--in HH:mm (24 ghante) me do, jaise 10:09.');
  if (newOut && !isHM(newOut)) usage('--out HH:mm me do, jaise 18:30.');
}

/** Ek bande ke ek mahine ke points — before/after milane ke liye. */
async function pointsOf(userId, month) {
  const rows = await PointEntry.find({ user: userId, month }).sort({ earnedYMD: 1, createdAt: 1 }).select('earnedYMD points reason source dedupeKey');
  return {
    total: rows.reduce((n, r) => n + (r.points || 0), 0),
    rows: rows.map((r) => `${r.earnedYMD || '—'}  ${String(r.points).padStart(4)}  ${r.source.padEnd(12)} ${r.reason}`),
  };
}

/** Sab ke streak awards — re-scan ke baad kuch aur to nahi ban gaya, ye dekhne ke liye. */
async function streakTally() {
  const rows = await PointEntry.find({ source: 'auto_streak' }).select('user earnedYMD points');
  return { count: rows.length, sum: rows.reduce((n, r) => n + (r.points || 0), 0), keys: new Set(rows.map((r) => `${r.user}|${r.earnedYMD}`)) };
}

async function main() {
  if (dbName) process.env.MONGODB_DB = dbName;
  await connectDB();
  line(`\nDatabase: ${mongoose.connection.name}${apply ? '' : '   (DRY RUN — kuch nahi badlega)'}`);

  const s = await Setting.getFullSingleton();
  const streakBefore = await streakTally();

  let user = null;
  let month = null;
  let before = null;

  // ── 1. Time theek karo ────────────────────────────────────────────────────
  if (who) {
    const rx = new RegExp(who.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const found = await User.find({ $or: [{ name: rx }, { email: rx }, { employeeId: rx }] }).select('name email employeeId role employmentType schedule dateOfJoining dateOfBirth');
    if (!found.length) usage(`"${who}" naam ka koi nahi mila.`);
    if (found.length > 1) usage(`"${who}" par ${found.length} log mile: ${found.map((u) => `${u.name} (${u.email})`).join(', ')} — poora email ya ID do.`);
    [user] = found;
    month = dateYMD.slice(0, 7);

    const day = companyDayFromYMD(dateYMD);
    const sched = effectiveSchedule(user, s);
    const record = await Attendance.findOne({ user: user._id, date: day });
    if (!record) usage(`${user.name} ka ${dateYMD} ka koi attendance record hi nahi hai — ye script maujooda din theek karti hai, naya nahi banati.`);

    before = await pointsOf(user._id, month);
    line(`\n${user.name} · ${user.email} · shift ${sched.workStart}–${sched.workEnd}, grace ${sched.graceMinutes} min`);
    line(`${dateYMD} abhi: ${record.status}  in ${hm(record.checkInAt)}  out ${hm(record.checkOutAt)}  overtime ${record.overtimeMinutes || 0}m${record.excused ? '  (EXCUSED)' : ''}`);

    // Wahi hisaab jo app ka correction karta hai.
    const inAt = newIn ? companyDayInstantAt(day, newIn) : record.checkInAt;
    const outAt = newOut ? companyDayInstantAt(day, newOut) : record.checkOutAt;
    const offDay = ['HOLIDAY', 'WEEKEND', 'ON_LEAVE', 'WFH'].includes(record.status);
    const nextStatus = offDay ? record.status : (judgeCheckIn(inAt, day, record, sched).rungs > 0 ? 'LATE' : 'PRESENT');
    let worked = record.workedMinutes || 0;
    let overtime = record.overtimeMinutes || 0;
    if (inAt && outAt) ({ workedMinutes: worked, overtimeMinutes: overtime } = computeWork(inAt, outAt, day, sched.workEnd, sched.overtimeAfterMinutes));

    line(`${dateYMD} naya: ${nextStatus}  in ${hm(inAt)}  out ${hm(outAt)}  overtime ${overtime}m`);
    if (offDay) line('   (chhutti/leave/WFH wala din hai — status waisa hi rakha jayega, sirf time badlega)');

    if (apply) {
      record.checkInAt = inAt;
      record.checkOutAt = outAt;
      record.status = nextStatus;
      record.workedMinutes = worked;
      record.overtimeMinutes = overtime;
      await record.save();

      // Points ko us din ke saath milaao — bilkul wahi hooks jo correction approve karta hai.
      await recomputeUserMonthOvertime(user._id, month);
      if (record.checkInAt) await clearAbsencePenalty(user._id, dateYMD);
      await reconcileLatePenalty(user._id, dateYMD, penaltyRungs(record, day, sched));
      await reconcilePerfectMonth(user._id, month);
      await audit({ actor: null, action: 'attendance.script_correction', entityType: 'Attendance', entityId: String(record._id), meta: { user: String(user._id), dateYMD, in: newIn || null, out: newOut || null, status: nextStatus, reason } });
      line('   ✔ record aur us din ke points update ho gaye');
    }
  }

  // ── 2. Streak dobara ginwao ───────────────────────────────────────────────
  if (rescanStreak) {
    line(`\nStreak: abhi ka nishaan (lastStreakScan) = ${s.bonus?.lastStreakScan || '(koi nahi)'}`);
    line(`Streak awards abhi: ${streakBefore.count} entries, kul ${streakBefore.sum} points`);
    if (apply) {
      // PURANE award pehle hataao, phir ginti dobara. Ye zaroori hai: ginti badalne par
      // award ALAG dinon par banta hai (chain aage-peechhe khisak jaati hai), aur har
      // award apni tareekh ki key se bachta hai — to purane na hataao to ek hi chain ke
      // do versions DB me pade reh jaate hain aur bande ko points do baar mil jaate hain.
      const wiped = await PointEntry.deleteMany({ source: 'auto_streak' });
      line(`   purane ${wiped.deletedCount} streak award hata kar ginti dobara…`);
      s.bonus.lastStreakScan = '';
      s.bonus.streakRuns = {};
      s.markModified('bonus.streakRuns');
      await s.save();
      Setting.invalidateCache();
      const fresh = await Setting.getSingleton();
      await runRollingStreak(fresh.bonus || {});
      const after = await streakTally();
      const added = [...after.keys].filter((k) => !streakBefore.keys.has(k));
      const gone = [...streakBefore.keys].filter((k) => !after.keys.has(k));
      line(`Streak awards ab : ${after.count} entries, kul ${after.sum} points`);
      line(`   naye award: ${added.length ? added.join(', ') : 'koi nahi'}`);
      line(`   ab nahi bante: ${gone.length ? gone.join(', ') : 'koi nahi'}  (purani ginti ke wo award jo naye hisaab se nahi banna chahiye the)`);
      const s2 = await Setting.getSingleton();
      line(`   naya nishaan: ${s2.bonus?.lastStreakScan}`);
    } else {
      line('   (--apply ke bina sirf dikhaya gaya hai; ginti nahi hui)');
    }
  }

  // ── 3. Before/after ───────────────────────────────────────────────────────
  if (user && apply) {
    const after = await pointsOf(user._id, month);
    line(`\n${user.name} · ${month} ke points: ${before.total} → ${after.total}  (farak ${after.total - before.total >= 0 ? '+' : ''}${after.total - before.total})`);
    const b = new Set(before.rows);
    const a = new Set(after.rows);
    const gone = [...b].filter((r) => !a.has(r));
    const added = [...a].filter((r) => !b.has(r));
    const JOIN = `\n         `;
    line('  hata : ' + (gone.length ? gone.join(JOIN) : '(kuch nahi)'));
    line('  juda : ' + (added.length ? added.join(JOIN) : '(kuch nahi)'));
  } else if (user) {
    line(`\n${user.name} · ${month} ke points abhi: ${before.total}`);
    line(before.rows.join('\n'));
    line('\n(DRY RUN — asli badlav ke liye wahi hukm --apply ke saath chalao)');
  }

  line('');
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('\n❌', e?.message || e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
