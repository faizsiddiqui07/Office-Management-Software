/**
 * Ek din se aage ke saare attendance records ka overtime DOBARA ginta hai — aaj ke code se.
 * Jab overtime ka niyam badle (ya wapas ho), us din ke baad ke stored `overtimeMinutes`
 * purane code ke hisaab se pade rehte hain; ye script unhe aaj ke computeWork par laati
 * hai aur jis user-month me kuch badla uske overtime points bhi dobara ginti hai.
 *
 * DEKHNE KE LIYE (kuch likhta nahi):   node scripts/recompute-overtime-from.js --from 2026-09-11
 * SACH ME CHALANE KE LIYE:             node scripts/recompute-overtime-from.js --from 2026-09-11 --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Attendance } from '../src/models/Attendance.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { companyDayFromYMD, computeWork, ymdInTz } from '../src/lib/time.js';
import { effectiveSchedule } from '../src/lib/schedule.js';
import { recomputeUserMonthOvertime } from '../src/services/bonus.service.js';

const APPLY = process.argv.includes('--apply');
const fromArg = process.argv[process.argv.indexOf('--from') + 1];
if (!/^\d{4}-\d{2}-\d{2}$/.test(fromArg || '')) {
  console.error('--from YYYY-MM-DD chahiye');
  process.exit(1);
}

async function main() {
  await connectDB();
  console.log(`\nDB: ${mongoose.connection.name}   |   from: ${fromArg}   |   mode: ${APPLY ? '⚠️  APPLY' : 'dry run'}\n`);
  const settings = await Setting.getSingleton();
  const users = new Map((await User.find().select('name schedule employmentType').lean()).map((u) => [String(u._id), u]));
  const recs = await Attendance.find({
    date: { $gte: companyDayFromYMD(fromArg) }, checkInAt: { $ne: null }, checkOutAt: { $ne: null },
  }).select('user date checkInAt checkOutAt overtimeMinutes').lean();

  const ops = [];
  const months = new Set();
  const fmt = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  for (const r of recs.sort((a, b) => a.date - b.date)) {
    const u = users.get(String(r.user));
    if (!u) continue;
    const sched = effectiveSchedule(u, settings);
    const { overtimeMinutes } = computeWork(r.checkInAt, r.checkOutAt, r.date, sched.workEnd, sched.overtimeAfterMinutes);
    const old = r.overtimeMinutes || 0;
    if (overtimeMinutes === old) continue;
    console.log(`  ${ymdInTz(r.date)}  ${u.name.padEnd(24)} in ${fmt(r.checkInAt)}  out ${fmt(r.checkOutAt)}   OT ${old} → ${overtimeMinutes} min`);
    ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { overtimeMinutes } } } });
    months.add(`${r.user}|${ymdInTz(r.date).slice(0, 7)}`);
  }
  console.log(`\n  ${recs.length} records dekhe, ${ops.length} badlenge, ${months.size} user-month ke points dobara ginenge`);

  // Points ka pehle-baad
  const ptsBefore = new Map();
  for (const key of months) {
    const [uid, month] = key.split('|');
    const row = await PointEntry.findOne({ user: uid, source: 'auto_ot', month }).lean();
    ptsBefore.set(key, row ? `${row.points} (${row.reason})` : '0');
  }

  if (!APPLY) {
    for (const [key, v] of ptsBefore) console.log(`  points abhi: ${users.get(key.split('|')[0])?.name} ${key.split('|')[1]} → ${v}`);
    console.log('\n(dry run — kuch nahi likha gaya. Chalane ke liye: --apply)\n');
    await disconnectDB();
    return;
  }
  if (!ops.length) { console.log('\nkuch badalne ko nahi.\n'); await disconnectDB(); return; }

  await Attendance.bulkWrite(ops);
  for (const key of months) {
    const [uid, month] = key.split('|');
    await recomputeUserMonthOvertime(uid, month);
    const row = await PointEntry.findOne({ user: uid, source: 'auto_ot', month }).lean();
    console.log(`  ✅ ${users.get(uid)?.name} ${month}: points ${ptsBefore.get(key)}  →  ${row ? `${row.points} (${row.reason})` : '0'}`);
  }
  console.log('\n✅ ho gaya.\n');
  await disconnectDB();
}

main().catch((e) => { console.error(e); process.exit(1); });
