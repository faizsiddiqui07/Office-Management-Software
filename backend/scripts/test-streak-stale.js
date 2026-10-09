/**
 * Retroactive attendance badlne par punctual-streak dobara judge hoti hai ya nahi — iska test.
 *
 * KYA SAABIT KARTA HAI. Rolling scan har din ko sirf EK BAAR dekhta hai (`lastStreakScan`)
 * aur aage badh jaata hai. Isliye jis din ko wo judge kar chuka hai, uska data baad me
 * badle — late maaf hui, backdated leave approve hui, regularization aayi, leadership ne
 * entry theek ki — to jo award banna chahiye tha wo kabhi nahi banta. Pehle ise sirf
 * "Recalculate points" pakad paata tha. Ab har aisa raasta `markStreaksStale()` lagata hai
 * aur scheduler ka agla tick poori chain dobara chala deta hai.
 *
 * SABSE ZAROORI CHEEZ JO YE PAKADTA HAI: double-pay. Chain nayi taarikhon par banti hai aur
 * awardOnce sirf insert karta hai — agar purane award pehle na hataye jayein to DONO version
 * table me reh jaate hain aur har us bande ko dugna mil jaata hai jiski chain khiski ho. Ye
 * galti ek baar ho chuki hai. Isliye test rescan ko DO BAAR chalata hai aur ginti waise ki
 * waisi hone par hi pass karta hai.
 *
 * Prod par chalane se INKAAR karta hai — DB ke naam me "test" hona zaroori hai.
 *
 *   node scripts/_clone-to-test-db.js --to office_test_streak
 *   MONGODB_DB=office_test_streak node scripts/test-streak-stale.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Attendance } from '../src/models/Attendance.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { markStreaksStale, maybeRunDaily, runRollingStreak } from '../src/services/bonus.service.js';
import { excuseLate } from '../src/services/attendance.service.js';
import { ymdInTz } from '../src/lib/time.js';

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); } else { fail += 1; console.log(`  ❌ ${label}${extra ? `  — ${extra}` : ''}`); }
};
const streakCount = () => PointEntry.countDocuments({ source: 'auto_streak' });
const staleMark = async () => (await Setting.findOne({ key: 'global' }).select('bonus.streaksStale').lean())?.bonus?.streaksStale || '';
const scanMark = async () => (await Setting.findOne({ key: 'global' }).select('bonus.lastStreakScan').lean())?.bonus?.lastStreakScan || '';

await connectDB();
const dbName = mongoose.connection.db.databaseName;
if (!/test/i.test(dbName)) {
  console.error(`\n⛔ "${dbName}" par nahi chalunga — naam me "test" hona chahiye.\n   MONGODB_DB=office_test_streak node scripts/test-streak-stale.js\n`);
  process.exit(1);
}
console.log(`\n🧪 DB: ${dbName}\n`);

// ── 1. Shuruati haalat ────────────────────────────────────────────────────────────────
console.log('1) Shuruati haalat');
const baseline = await streakCount();
ok(baseline > 0, `DB me pehle se ${baseline} streak award hain`);
await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.streaksStale': '' } });
Setting.invalidateCache();

// ── 2. Bina mark ke tick kuch na chhede ──────────────────────────────────────────────
console.log('\n2) Bina stale-mark ke scheduler tick');
await maybeRunDaily();
ok(await streakCount() === baseline, 'koi mark nahi tha → award ginti waisi ki waisi', `${await streakCount()} vs ${baseline}`);

// ── 3. Mark lagao → tick → poori chain dobara bane ───────────────────────────────────
console.log('\n3) Stale mark → tick → poora re-walk');
await markStreaksStale();
const mark1 = await staleMark();
ok(!!mark1, 'markStreaksStale() ne nishaan laga diya');
// Nishaan ka matlab hi yahi hai ki watermark par bharosa nahi — use peechhe le jaane ki
// zaroorat nahi, rescan khud clear karta hai. Tick chalao.
await maybeRunDaily();
const afterRescan = await streakCount();
ok(afterRescan >= baseline, `re-walk ke baad ${afterRescan} award (pehle ${baseline})`);
ok(await staleMark() === '', 'nishaan hat gaya');
ok(await scanMark() !== '', 'watermark wapas set ho gaya', `= ${await scanMark()}`);

// ── 4. DOUBLE-PAY — sabse zaroori ────────────────────────────────────────────────────
console.log('\n4) Double-pay nahi hona chahiye');
await markStreaksStale();
await maybeRunDaily();
const twice = await streakCount();
ok(twice === afterRescan, `dobara re-walk par ginti wahi rahi (${twice})`, `pehle ${afterRescan}, ab ${twice}`);
await markStreaksStale();
await maybeRunDaily();
const thrice = await streakCount();
ok(thrice === afterRescan, `teesri baar bhi wahi (${thrice})`);
// Ek bhi banda do baar ek hi din ka award na le
const dupes = await PointEntry.aggregate([
  { $match: { source: 'auto_streak' } },
  { $group: { _id: { u: '$user', d: '$earnedYMD' }, n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } },
]);
ok(dupes.length === 0, 'kisi ko bhi ek din ka award do baar nahi mila', `${dupes.length} duplicate`);

// ── 5. Live scan aur re-walk ek hi jawab dein ────────────────────────────────────────
console.log('\n5) Do swatantra hisaab ek hi jawab dein');
const beforeIdem = await streakCount();
await maybeRunDaily(); // bina mark ke — incremental scan
ok(await streakCount() === beforeIdem, 'mark ke bina incremental scan kuch nahi jodta');

// ── 6. excuseLate asli raasta — nishaan lagta hai? ───────────────────────────────────
console.log('\n6) Late maaf karne par nishaan lagta hai');
await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.streaksStale': '' } });
Setting.invalidateCache();
const lateRec = await Attendance.findOne({ status: 'LATE', excused: { $ne: true } }).sort({ date: -1 });
if (!lateRec) {
  console.log('  ⏭️  koi bina-excuse ki LATE row nahi mili — ye hissa chhoda');
} else {
  const approver = await User.findOne({}).select('_id');
  await excuseLate(approver, lateRec._id, true);
  ok(!!(await staleMark()), `excuseLate(${ymdInTz(lateRec.date)}) ne nishaan laga diya`);
  await maybeRunDaily();
  ok(await staleMark() === '', 'tick ne nishaan saaf kar diya');
  // wapas pehle jaisa
  await excuseLate(approver, lateRec._id, false);
  await maybeRunDaily();
}

// ── 7. Rescan ke beech aaya naya badlav nigla na jaye ────────────────────────────────
console.log('\n7) Re-walk ke DAURAAN aaya naya nishaan nigla na jaye');
await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.streaksStale': 'purana-token' } });
Setting.invalidateCache();
// Naya nishaan (jaise koi re-walk ke beech me late maaf kar de)
await markStreaksStale();
const newMark = await staleMark();
ok(newMark !== 'purana-token' && !!newMark, 'naya nishaan purane ke upar chadh gaya');
// Purane token se clear karne ki koshish naye nishaan ko na mitaye
await Setting.updateOne({ key: 'global', 'bonus.streaksStale': 'purana-token' }, { $set: { 'bonus.streaksStale': '' } });
Setting.invalidateCache();
ok(await staleMark() === newMark, 'purane token se clear karne par naya nishaan bacha raha');
await maybeRunDaily();
ok(await staleMark() === '', 'tick ne naye nishaan ko bhi nipta diya');

// ── 8. Lock liya hua ho to rescan ruk jaye, nishaan bacha rahe ───────────────────────
console.log('\n8) Recalculate chal raha ho to rescan ruke, nishaan na khoye');
await markStreaksStale();
const heldMark = await staleMark();
await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.rebuildLock': 'kisi-aur-ka', 'bonus.rebuildLockUntil': new Date(Date.now() + 60000) } });
Setting.invalidateCache();
const beforeLocked = await streakCount();
await maybeRunDaily();
ok(await staleMark() === heldMark, 'lock lagi thi → nishaan waisa ka waisa (agle tick par hoga)');
ok(await streakCount() === beforeLocked, 'lock lagi thi → streak table ko haath nahi lagaya');
await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.rebuildLock': '', 'bonus.rebuildLockUntil': null } });
Setting.invalidateCache();
await maybeRunDaily();
ok(await staleMark() === '', 'lock hatte hi agle tick par nishaan nipat gaya');

// ── 9. Aakhri sehat jaanch — niyam aur table ab bhi ek-doosre se mile ────────────────
console.log('\n9) Aakhir me table niyam se mele');
const finalCount = await streakCount();
await PointEntry.deleteMany({ source: 'auto_streak' });
await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.lastStreakScan': '', 'bonus.streakRuns': {} } });
Setting.invalidateCache();
const s9 = await Setting.getSingleton();
await runRollingStreak(s9.bonus || {}, { ignoreLock: true });
const scratch = await streakCount();
ok(scratch === finalCount, `shuru se chalane par bhi utne hi award (${scratch} vs ${finalCount})`);

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} pass, ${fail} fail\n`);
await mongoose.disconnect();
process.exit(fail === 0 ? 0 : 1);
