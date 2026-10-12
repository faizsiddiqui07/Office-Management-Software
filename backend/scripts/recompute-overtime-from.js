/**
 * Ek din se aage ke saare attendance records ka overtime DOBARA ginta hai — aaj ke code se.
 *
 * Jab overtime ka niyam badle (ya wapas ho), us din ke baad ke stored `overtimeMinutes`
 * purane code ke hisaab se pade rehte hain; ye script unhe aaj ke computeWork par laati hai
 * aur un user-months ke overtime points bhi dobara ginti hai.
 *
 * YE OFF-DAY KA NISHAAN BHI LAGATA HAI. `Attendance.offDayWork` (dekho us model ka comment)
 * check-in ke waqt lagta hai — par jo din us feature se PEHLE ke hain unpar nishaan hai hi
 * nahi. Ye script un dinon ke liye calendar se ek baar faisla karke nishaan likh deti hai.
 * Uske baad wo din patthar par likhe rehte hain: baad me kisi ka weekly off badle ya holiday
 * hate, un guzre dinon ka overtime nahi hilega.
 *
 * POINTS HAR US USER-MONTH KE DOBARA GINTE HAIN JO WINDOW ME HAI — chahe uske minute badle
 * hon ya nahi. Isse do faayde: script dobara chalane layak ho jaati hai, aur agar kabhi
 * pichhla run beech me mara ho (minute naye, points purane) to wo bhi apne aap theek ho
 * jaata hai. `auto_ot` delete-then-insert hai (bonus.service.js recomputeMonthlyOvertime),
 * isliye dobara chalana bilkul surakshit hai.
 *
 * DEKHNE KE LIYE (kuch likhta nahi):
 *   node scripts/recompute-overtime-from.js --from 2026-10-01
 * KISI COPY PAR REHEARSAL:
 *   node scripts/recompute-overtime-from.js --from 2026-10-01 --db office_test_ot --apply
 * SACH ME CHALANE KE LIYE:
 *   node scripts/recompute-overtime-from.js --from 2026-10-01 --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const APPLY = process.argv.includes('--apply');
const flag = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const fromArg = flag('from');
if (!/^\d{4}-\d{2}-\d{2}$/.test(fromArg || '')) {
  console.error('--from YYYY-MM-DD chahiye');
  process.exit(1);
}
// `--db` connectDB se PEHLE set hona chahiye. Iske bina default prod hai (office_management),
// aur rehearsal ke liye har baar haath se MONGODB_DB set karna padta tha — ek baar bhoole to
// clone ke bajaye seedha prod. fix-checkin.js me ye flag pehle se hai; yahan nahi tha.
const dbArg = flag('db');
if (dbArg) process.env.MONGODB_DB = dbArg;

const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { Setting } = await import('../src/models/Setting.js');
const { User } = await import('../src/models/User.js');
const { Attendance } = await import('../src/models/Attendance.js');
const { PointEntry } = await import('../src/models/PointEntry.js');
const { companyDayFromYMD, computeWork, ymdInTz, OFFDAY_FULL_OT_FLOOR_YMD } = await import('../src/lib/time.js');
const { effectiveSchedule } = await import('../src/lib/schedule.js');
const { isOffDaySync } = await import('../src/lib/offDay.js');
const { holidayYMDSet } = await import('../src/services/holiday.service.js');
const { recomputeUserMonthOvertime } = await import('../src/services/bonus.service.js');

/**
 * Mahine ke kul overtime minute se points — bonus.service.js ke recomputeMonthlyOvertime ka
 * hu-ba-hu hisaab, SIRF dry-run me dikhane ke liye. Asli likhai hamesha usi function se hoti
 * hai; ye yahan isliye hai ki owner ko --apply se pehle "pehle → baad" dikh sake.
 */
const pointsFor = (totalMin, rate) => {
  const hours = Math.floor(totalMin / 60);
  const leftover = totalMin % 60;
  return hours * rate + (leftover > 30 ? Math.round(rate / 2) : 0);
};

async function main() {
  await connectDB();
  console.log(`\nDB: ${mongoose.connection.name}   |   from: ${fromArg}   |   mode: ${APPLY ? '⚠️  APPLY' : 'dry run'}`);
  console.log(`off-day poora-din overtime ka floor: ${OFFDAY_FULL_OT_FLOOR_YMD}\n`);

  const settings = await Setting.getSingleton();
  const bonus = settings.bonus || {};
  // Bonus band ho to recomputeUserMonthOvertime CHUPCHAAP kuch nahi karta — minute badal
  // jaate aur points waise hi pade rehte. Isliye pehle hi saaf bata do.
  if (!bonus.enabled) console.log('⚠️  Bonus system BAND hai — minute to theek honge, par points nahi banenge.\n');
  let rate = 0;
  for (const h of (bonus.rateHistory || [])) {
    const r = (h.rules || []).find((x) => x.key === 'overtimeHour');
    if (r) rate = Math.abs(Number(r.points) || 0);
  }

  const users = new Map((await User.find().select('name schedule employmentType dateOfBirth').lean()).map((u) => [String(u._id), u]));
  const recs = await Attendance.find({
    date: { $gte: companyDayFromYMD(fromArg) }, checkInAt: { $ne: null }, checkOutAt: { $ne: null },
  }).select('user date checkInAt checkOutAt overtimeMinutes offDayWork').lean();
  if (!recs.length) { console.log('is window me koi poora record nahi.\n'); await disconnectDB(); return; }

  // Holiday set EK BAAR, poore range ka — per-record query Lambda/loop dono me mehengi hai.
  const ymds = recs.map((r) => ymdInTz(r.date)).sort();
  const holidaySet = await holidayYMDSet(ymds[0], ymds[ymds.length - 1]);

  const ops = [];
  const months = new Set();          // window ke SAARE user-month
  const otNow = new Map();           // key → kul OT minute (abhi)
  const otAfter = new Map();         // key → kul OT minute (baad me)
  const drops = [];                  // jinka overtime GHAT raha hai — alag se dikhana hai
  const fmt = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

  for (const r of recs.sort((a, b) => a.date - b.date)) {
    const u = users.get(String(r.user));
    if (!u) continue;
    const ymd = ymdInTz(r.date);
    const key = `${r.user}|${ymd.slice(0, 7)}`;
    months.add(key);

    const sched = effectiveSchedule(u, settings);
    const offDay = isOffDaySync(u, ymd, settings, holidaySet);
    const { overtimeMinutes } = computeWork(r.checkInAt, r.checkOutAt, r.date, sched.workEnd, sched.overtimeAfterMinutes, offDay);
    const old = r.overtimeMinutes || 0;

    otNow.set(key, (otNow.get(key) || 0) + Math.max(0, old));
    otAfter.set(key, (otAfter.get(key) || 0) + Math.max(0, overtimeMinutes));

    const stampChanged = !!r.offDayWork !== offDay;
    if (overtimeMinutes === old && !stampChanged) continue;

    const why = offDay ? (holidaySet.has(ymd) ? 'holiday' : 'off/bday') : '';
    const arrow = overtimeMinutes === old ? `OT ${old} min (waisa hi)` : `OT ${old} → ${overtimeMinutes} min`;
    const mark = overtimeMinutes < old ? '   ⚠️ GHAT RAHA HAI' : '';
    if (overtimeMinutes < old) drops.push({ ymd, name: u.name, old, now: overtimeMinutes });
    console.log(`  ${ymd}  ${u.name.padEnd(20)} in ${fmt(r.checkInAt)}  out ${fmt(r.checkOutAt)}  ${why.padEnd(9)} ${arrow}${mark}`);

    ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { overtimeMinutes, offDayWork: offDay } } } });
  }

  console.log(`\n  ${recs.length} record dekhe, ${ops.length} row badlenge, ${months.size} user-month ke points dobara ginenge`);
  if (drops.length) {
    console.log(`\n  ⚠️  ${drops.length} din aise hain jinka overtime GHAT raha hai — apply se pehle owner ko dikhana zaroori:`);
    for (const d of drops) console.log(`      ${d.ymd}  ${d.name}  ${d.old} → ${d.now} min`);
  }

  console.log('\n  points (overtimeHour rate = ' + rate + '/ghanta):');
  for (const key of [...months].sort()) {
    const [uid, month] = key.split('|');
    const row = await PointEntry.findOne({ user: uid, source: 'auto_ot', month }).lean();
    const before = row ? row.points : 0;
    const after = pointsFor(otAfter.get(key) || 0, rate);
    const delta = after - before;
    const tag = delta === 0 ? '' : (delta > 0 ? `  (+${delta})` : `  (${delta})`);
    console.log(`      ${(users.get(uid)?.name || uid).padEnd(20)} ${month}  OT ${otNow.get(key) || 0} → ${otAfter.get(key) || 0} min   points ${before} → ${after}${tag}`);
  }

  if (!APPLY) {
    console.log('\n(dry run — kuch nahi likha gaya. Chalane ke liye: --apply)\n');
    await disconnectDB();
    return;
  }

  if (ops.length) await Attendance.bulkWrite(ops);
  // SAARE user-month, sirf badle hue nahi — upar wala comment dekho.
  let okCount = 0;
  for (const key of months) {
    const [uid, month] = key.split('|');
    try {
      await recomputeUserMonthOvertime(uid, month);
      okCount += 1;
    } catch (e) {
      console.error(`  ❌ points recompute fail: ${users.get(uid)?.name} ${month} — ${e?.message}`);
    }
  }
  console.log(`\n  ${ops.length} row likhe, ${okCount}/${months.size} user-month ke points dobara gine. Ab ki haalat:`);
  for (const key of [...months].sort()) {
    const [uid, month] = key.split('|');
    const row = await PointEntry.findOne({ user: uid, source: 'auto_ot', month }).lean();
    console.log(`      ${(users.get(uid)?.name || uid).padEnd(20)} ${month}  →  ${row ? `${row.points} points (${row.reason})` : '0 points'}`);
  }
  console.log('\n✅ ho gaya.\n');
  await disconnectDB();
}

main().catch((e) => { console.error(e); process.exit(1); });
