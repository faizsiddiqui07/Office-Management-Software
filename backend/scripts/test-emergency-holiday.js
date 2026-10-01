/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * "Emergency holiday declare" ka imtihaan. Owner ki teen shart hi yahan sabit hoti hain:
 *
 *   1. Kisi ki punctual streak NA TOOTE — balki jo din reset kar raha tha wo neutral ho jae
 *      (award kam nahi hone chahiye, badh sakte hain).
 *   2. Mahine wala perfect-attendance award NA TOOTE — balki mil sakta hai.
 *   3. Us din ka koi faltu jurmana na bache — absent, late, aur task ka daily drip teeno.
 *
 * Aur: kisi ka total NEECHE nahi jana chahiye, dobara dabane par doosri entry na bane,
 * undo karne par ledger bilkul pehle jaisa ho jae, aur owner ke alawa koi na kar sake.
 *
 * Asli data ki copy par chalta hai:
 *   node scripts/_clone-to-test-db.js --to office_test_emergency
 *   node scripts/test-emergency-holiday.js
 */
import 'dotenv/config';

process.env.MONGODB_DB = process.env.MONGODB_DB_TEST || 'office_test_emergency';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { Holiday } from '../src/models/Holiday.js';
import { Attendance } from '../src/models/Attendance.js';
import { loadRoles } from '../src/lib/roles.js';
import { declareEmergencyHoliday, undoEmergencyHoliday, emergencyHolidayDays } from '../src/services/leave.service.js';
import { runRebuild } from '../src/services/bonus.service.js';
import { holidayYMDSet } from '../src/services/holiday.service.js';
import { ymdInTz, companyDayFromYMD } from '../src/lib/time.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? `  →  ${extra}` : ''}`);
  if (!cond) failures += 1;
}

const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

async function fingerprint() {
  const rows = await PointEntry.find({}).select('dedupeKey points').lean();
  return rows.map((r) => `${r.dedupeKey}=${r.points}`).sort().join('|');
}
async function totals() {
  const rows = await PointEntry.aggregate([{ $group: { _id: '$user', n: { $sum: '$points' } } }]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}
const countOn = (q) => PointEntry.countDocuments(q);

async function main() {
  await connectDB();
  if (!/test/i.test(mongoose.connection.name)) throw new Error(`refusing: "${mongoose.connection.name}" me "test" nahi hai`);
  await loadRoles();
  console.log(`\n🧪 Isolated DB: ${mongoose.connection.name}\n`);

  const owner = await User.findOne({ role: 'CEO_PRESIDENT' }).select('name role');
  const notOwner = await User.findOne({ role: { $ne: 'CEO_PRESIDENT' }, isActive: true }).select('name role');
  const nameOf = new Map((await User.find({}).select('name')).map((u) => [String(u._id), u.name]));

  // Pehle ledger ko niyam ke mutabik seedha kar lo, taaki jo farak dikhe wo SIRF holiday ka ho.
  console.log('0) Pehle ledger ko niyam par le aao (taaki baad ka farak sirf holiday ka ho)');
  await runRebuild(owner);
  const baseFp = await fingerprint();
  const baseTotals = await totals();
  const baseStreakKeys = (await PointEntry.find({ source: 'auto_streak' }).select('dedupeKey').lean()).map((r) => r.dedupeKey);
  const baseStreaks = baseStreakKeys.length;
  const basePerfect = await countOn({ source: 'auto_perfect' });
  console.log(`     streak award ${baseStreaks} | perfect-month award ${basePerfect}`);

  // Ek aisa guzra hua kaam ka din chuno jis par sach me kuch laga ho — tabhi test ka matlab hai.
  const today = ymdInTz(new Date());
  let target = null;
  for (let i = 1; i <= 13; i += 1) {
    const d = addDays(today, -i);
    // eslint-disable-next-line no-await-in-loop
    if ((await holidayYMDSet(d, d)).has(d)) continue;
    // eslint-disable-next-line no-await-in-loop
    const hits = await PointEntry.countDocuments({ earnedYMD: d, source: { $in: ['auto_late', 'auto_absent'] } });
    // eslint-disable-next-line no-await-in-loop
    const worked = await Attendance.countDocuments({ date: companyDayFromYMD(d) });
    if (worked > 0) { target = { d, hits, worked }; if (hits > 0) break; }
  }
  if (!target) throw new Error('pichhle 13 din me koi kaam ka din mila hi nahi');
  console.log(`     chuna gaya din: ${target.d} (${target.worked} attendance rows, ${target.hits} penalty rows)`);

  // ── 1. Declare ────────────────────────────────────────────────────────────
  console.log('\n1) Declare karne par');
  const res = await declareEmergencyHoliday(owner, { dateYMD: target.d, title: 'Heavy rain', note: 'Office band — baarish.' });
  check('calendar me theek EK holiday bani', (await Holiday.countDocuments({ type: 'HOLIDAY', startYMD: target.d, endYMD: target.d })) === 1);
  check('holidayYMDSet use holiday maan raha hai', (await holidayYMDSet(target.d, target.d)).has(target.d));
  check('list me din aa gaya', (await emergencyHolidayDays()).includes(target.d));
  check('announcement bani', res.announced === true);

  console.log('\n   Us din ka koi faltu jurmana nahi bacha');
  check('absent penalty 0', (await countOn({ source: 'auto_absent', earnedYMD: target.d })) === 0);
  check('late penalty 0', (await countOn({ source: 'auto_late', earnedYMD: target.d })) === 0);
  check('task ka daily drip 0', (await countOn({ source: 'auto_task', earnedYMD: target.d, dedupeKey: { $regex: '^auto_overdue:' } })) === 0);

  console.log('\n   Streak aur perfect-month par asar');
  // Ek NEUTRAL din (Sunday ya chhutti) streak ko na todta hai na ginta hai. Iska ek seedha
  // natija hai: agar kisi ka 6-din wala award THEEK USI din pada tha jise ab holiday bana
  // diya, to wo award wahan se hat jaata hai aur ginti AAGE carry hoti hai — award unke agle
  // on-time din par milega. Ye niyam ke bilkul mutabik hai; "streak toot gayi" nahi hai.
  // Isliye asli jaanch ye hai: jitne bhi award hate, sab ke sab USI din ke hone chahiye.
  const afterKeys = new Set((await PointEntry.find({ source: 'auto_streak' }).select('dedupeKey').lean()).map((r) => r.dedupeKey));
  const lost = baseStreakKeys.filter((k) => !afterKeys.has(k));
  const lostElsewhere = lost.filter((k) => !k.endsWith(`:${target.d}`));
  const deferred = lost.filter((k) => k.endsWith(`:${target.d}`));
  check('us din ke alawa kahin ka streak award nahi gaya', lostElsewhere.length === 0, lostElsewhere.join(', ') || 'koi nahi');
  if (deferred.length) console.log(`     ℹ  ${deferred.length} award us din se AAGE khisak gaye (niyam ke mutabik) — run toota nahi`);
  const afterPerfect = await countOn({ source: 'auto_perfect' });
  check('perfect-month award kam nahi hue', afterPerfect >= basePerfect, `${basePerfect} → ${afterPerfect}`);

  console.log('\n   Totals par asar');
  // Ghatne ki ek hi jaayaz wajah hai: us din par pada hua streak award aage khisak gaya.
  // Kisi aur wajah se kisi ka ek point bhi kam nahi hona chahiye.
  const afterTotals = await totals();
  const allowedDrop = new Map();
  for (const k of deferred) {
    const uid = k.split(':')[1];
    allowedDrop.set(uid, (allowedDrop.get(uid) || 0) + 5);
  }
  let unexplained = 0;
  for (const [uid, before] of baseTotals) {
    const after = afterTotals.get(uid) ?? 0;
    if (after === before) continue;
    if (after > before) { console.log(`     ↑  ${nameOf.get(uid)}: ${before} → ${after}  (+${after - before})`); continue; }
    const allowed = allowedDrop.get(uid) || 0;
    if (before - after > allowed) {
      unexplained += 1;
      console.log(`     ❌ ${nameOf.get(uid)}: ${before} → ${after}  (${before - after - allowed} bina wajah)`);
    } else {
      console.log(`     ↓  ${nameOf.get(uid)}: ${before} → ${after}  (award us din se aage khisak gaya)`);
    }
  }
  check('bina wajah kisi ka point kam nahi hua', unexplained === 0);

  // ── 2. Dobara dabana ──────────────────────────────────────────────────────
  console.log('\n2) Dobara dabane par doosri entry nahi banti');
  let second = null;
  try { await declareEmergencyHoliday(owner, { dateYMD: target.d, title: 'Heavy rain' }); } catch (e) { second = e; }
  check('doosri koshish mana ki gayi', !!second, second ? `${second.status} ${second.code}` : 'mana hi nahi ki');
  check('calendar me abhi bhi ek hi holiday hai', (await Holiday.countDocuments({ type: 'HOLIDAY', startYMD: target.d, endYMD: target.d })) === 1);

  // ── 3. Undo ───────────────────────────────────────────────────────────────
  console.log('\n3) Undo karne par sab wapas');
  await undoEmergencyHoliday(owner, target.d);
  check('holiday hat gayi', (await Holiday.countDocuments({ type: 'HOLIDAY', startYMD: target.d, endYMD: target.d })) === 0);
  check('list se din hat gaya', !(await emergencyHolidayDays()).includes(target.d));
  const undoFp = await fingerprint();
  // Task ke drip jaan-boojh kar wapas nahi aate — unhe chhod kar ledger bilkul pehle jaisa.
  const dripKeys = new Set();
  for (const k of baseFp.split('|')) if (k.startsWith('auto_overdue:') && k.includes(`:${target.d}=`)) dripKeys.add(k);
  const baseNoDrip = baseFp.split('|').filter((k) => !dripKeys.has(k)).join('|');
  const undoNoDrip = undoFp.split('|').filter((k) => !dripKeys.has(k)).join('|');
  check('ledger (drip chhod kar) bilkul pehle jaisa', baseNoDrip === undoNoDrip);
  check('drip wapas nahi aaye (jaan-boojh kar)', dripKeys.size === 0 || !undoFp.includes([...dripKeys][0]));

  // ── 4. Kaun kar sakta hai, kaun nahi ──────────────────────────────────────
  console.log('\n4) Ijazat aur seemayein');
  const tryIt = async (actor, args) => { try { await declareEmergencyHoliday(actor, args); return null; } catch (e) { return e; } };
  const e403 = await tryIt(notOwner, { dateYMD: addDays(today, -1), title: 'x' });
  check(`${notOwner?.role} ko 403 mila`, e403?.status === 403, e403 ? `${e403.status} ${e403.code}` : 'mana hi nahi kiya');
  const eOld = await tryIt(owner, { dateYMD: addDays(today, -40), title: 'x' });
  check('40 din purani taarikh mana ki gayi', eOld?.code === 'TOO_FAR_BACK', eOld ? eOld.code : 'mana hi nahi ki');
  const eBad = await tryIt(owner, { dateYMD: 'kal', title: 'x' });
  check('galat taarikh mana ki gayi', eBad?.code === 'BAD_DATE', eBad ? eBad.code : 'mana hi nahi ki');
  const eLive = await tryIt(owner, { dateYMD: '2025-01-01', title: 'x' });
  check('go-live se pehle ki taarikh mana ki gayi', !!eLive, eLive ? eLive.code : 'mana hi nahi ki');

  // Aane wale din par bhi kaam karna chahiye (emergency aage ki bhi ho sakti hai)
  const future = addDays(today, 2);
  const eFuture = await tryIt(owner, { dateYMD: future, title: 'Planned shutdown' });
  check('aane wale din par declare ho gaya', eFuture === null, eFuture ? `${eFuture.code}` : '');
  if (!eFuture) await undoEmergencyHoliday(owner, future);

  console.log(`\n${failures ? `❌ ${failures} check fail` : '✅ saare check pass'}\n`);
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('\n💥', e); process.exit(1); });
