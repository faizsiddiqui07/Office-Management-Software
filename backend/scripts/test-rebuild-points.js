/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * "Recalculate points" (previewRebuild + runRebuild) ka poora imtihaan. Chaar cheezein
 * sabit karta hai:
 *
 *   1. PREVIEW kuch nahi likhta — chalane se pehle aur baad me ledger bilkul ek jaisa.
 *   2. APPLY jo preview ne kaha tha, bas wahi karta hai — har bande ka before/after milta hai.
 *   3. APPLY ke baad niyam aur ledger me koi farak nahi bachta (`verified: true`).
 *   4. DOBARA dabane par ek bhi point nahi hilta (idempotent) — yahi wo galti thi jisse
 *      26 Sep 2026 ko Ankit ko 15 points zyada mil gaye the.
 *
 * Saath me: lock kaam karta hai (dusri koshish 409), aur rebuild un sources ko haath
 * nahi lagata jo uske nahi hain (auto_ot, auto_task, auto_overdue, manual award).
 *
 * Asli data ki copy par chalta hai, taaki natija asli ho:
 *   node scripts/_clone-to-test-db.js --to office_test_rebuild
 *   node scripts/test-rebuild-points.js
 *
 * Khud ka banaya hua data chahiye to --synthetic do (copy ki zaroorat nahi).
 */
import 'dotenv/config';

process.env.MONGODB_DB = process.env.MONGODB_DB_TEST || 'office_test_rebuild';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { loadRoles } from '../src/lib/roles.js';
import { previewRebuild, runRebuild, reconcileLatePenalty, reconcileAbsence, reconcilePerfectMonth, reconcileNoLeaveMonth } from '../src/services/bonus.service.js';
import { Attendance } from '../src/models/Attendance.js';
import { effectiveSchedule } from '../src/lib/schedule.js';
import { penaltyRungs } from '../src/lib/lateLadder.js';
import { periodStartFor } from '../src/lib/joining.js';
import { can } from '../src/lib/permissions.js';
import { ymdInTz, companyDayFromYMD } from '../src/lib/time.js';
import { APP_LIVE_YMD } from '../src/lib/appLive.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? `  →  ${extra}` : ''}`);
  if (!cond) failures += 1;
}

/** Poore ledger ka ek fingerprint — ek bhi row/point badla to ye badal jayega. */
async function ledgerFingerprint() {
  const rows = await PointEntry.find({}).select('dedupeKey points user source earnedYMD').lean();
  return rows
    .map((r) => `${r.dedupeKey || `${r.user}:${r.source}:${r.earnedYMD}`}=${r.points}`)
    .sort()
    .join('|');
}

async function totalsByUser() {
  const rows = await PointEntry.aggregate([{ $group: { _id: '$user', n: { $sum: '$points' } } }]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

async function countsBySource() {
  const rows = await PointEntry.aggregate([{ $group: { _id: '$source', n: { $sum: 1 }, pts: { $sum: '$points' } } }]);
  return new Map(rows.map((r) => [r._id, { n: r.n, pts: r.pts }]));
}

async function main() {
  await connectDB();
  if (!/test/i.test(mongoose.connection.name)) throw new Error(`refusing: "${mongoose.connection.name}" ke naam me "test" nahi hai`);
  await loadRoles();
  console.log(`\n🧪 Isolated DB: ${mongoose.connection.name}\n`);

  const owner = await User.findOne({ role: 'CEO_PRESIDENT' }).select('name role');
  if (!owner) throw new Error('is DB me koi CEO_PRESIDENT nahi — copy sahi bani hai?');
  const nameOf = new Map((await User.find({}).select('name')).map((u) => [String(u._id), u.name]));

  // ── 1. Preview kuch likhta nahi ────────────────────────────────────────────
  console.log('1) PREVIEW kuch likhta nahi');
  const fpBefore = await ledgerFingerprint();
  const t0 = Date.now();
  const preview = await previewRebuild(owner);
  const previewMs = Date.now() - t0;
  const fpAfterPreview = await ledgerFingerprint();
  check('ledger preview ke baad bilkul waisa hi hai', fpBefore === fpAfterPreview);
  check('preview 30s ki Lambda limit me hai', previewMs < 30000, `${previewMs} ms`);
  console.log(`     roster ${preview.rosterCount} log | mahine ${preview.months.join(', ')}`);
  console.log(`     ${preview.movedCount} logon ke total hilenge (kul ${preview.totalDelta > 0 ? '+' : ''}${preview.totalDelta}), ${preview.datesOnlyCount} ke sirf taareekhein`);
  for (const r of preview.rows) {
    console.log(`       ${r.name.padEnd(26)} ${String(r.before).padStart(5)} → ${String(r.after).padStart(5)}  ${r.delta > 0 ? '+' : ''}${r.delta}`);
    for (const c of r.changes) console.log(`         ${c.kind.padEnd(6)} ${c.what} · ${c.on} · ${c.points > 0 ? '+' : ''}${c.points}${c.was !== undefined ? ` (pehle ${c.was})` : ''}`);
  }

  // ── 2. Apply wahi karta hai jo preview ne kaha ─────────────────────────────
  console.log('\n2) APPLY exactly wahi karta hai jo preview ne bataya');
  const totalsBefore = await totalsByUser();
  const srcBefore = await countsBySource();
  const t1 = Date.now();
  const result = await runRebuild(owner);
  const applyMs = Date.now() - t1;
  const totalsAfter = await totalsByUser();
  check('apply 30s ki Lambda limit me hai', applyMs < 30000, `${applyMs} ms`);

  const promised = new Map(preview.rows.map((r) => [r.userId, r.delta]));
  let mismatched = 0;
  const allIds = new Set([...totalsBefore.keys(), ...totalsAfter.keys()]);
  for (const uid of allIds) {
    const actual = (totalsAfter.get(uid) ?? 0) - (totalsBefore.get(uid) ?? 0);
    const said = promised.get(uid) ?? 0;
    if (actual !== said) {
      mismatched += 1;
      console.log(`     ❌ ${nameOf.get(uid) || uid}: preview ne ${said} kaha, hua ${actual}`);
    }
  }
  check('har bande ka asli farak preview se bilkul milta hai', mismatched === 0, `${allIds.size} log jaanche`);
  check('rebuild khud ko verified bata raha hai', result.verified === true, result.verified ? '' : `bacha hua: ${JSON.stringify(result.leftover).slice(0, 300)}`);

  // ── 3. Jo sources rebuild ke nahi hain, wo chhue hi nahi gaye ──────────────
  console.log('\n3) Doosre sources ko haath nahi lagaya');
  const srcAfter = await countsBySource();
  const OWNED = new Set(['auto_streak', 'auto_late', 'auto_absent', 'auto_perfect', 'auto_noleave']);
  const untouched = [...new Set([...srcBefore.keys(), ...srcAfter.keys()])].filter((k) => !OWNED.has(k));
  for (const k of untouched) {
    const a = srcBefore.get(k) || { n: 0, pts: 0 };
    const c = srcAfter.get(k) || { n: 0, pts: 0 };
    check(`${k} waise ka waisa`, a.n === c.n && a.pts === c.pts, `${a.n} rows / ${a.pts} pts → ${c.n} / ${c.pts}`);
  }

  // ── 3b. ASLI LIVE functions bhi wahi kehte hain ────────────────────────────
  // Rebuild speed ke liye ek hi bulkWrite karta hai, apne hisaab se. Isliye yahan wo ASLI
  // live reconcile functions chalaye jaate hain jo aam din me points likhte hain — agar
  // unke hisaab me koi farak hota, to ledger badal jaata. Nahi badla = dono hisaab barabar.
  console.log('\n3b) Live reconcile functions rebuild se sehmat hain');
  const fpBeforeLive = await ledgerFingerprint();
  const sAll = await Setting.getSingleton();
  const rosterUsers = (await User.find({ isActive: true }).select('name role employmentType schedule dateOfJoining dateOfBirth'))
    .filter((u) => can({ role: u.role }, 'markAttendance'));
  const addDay = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const yest = addDay(ymdInTz(new Date()), -1);
  const liveRecs = await Attendance.find({ date: { $gte: companyDayFromYMD(APP_LIVE_YMD) } })
    .select('user date status excused halfDayLeave halfDayPart checkInAt');
  const schedBy = new Map(rosterUsers.map((u) => [String(u._id), effectiveSchedule(u, sAll)]));
  for (const r of liveRecs) {
    const sch = schedBy.get(String(r.user));
    if (!sch) continue;
    // eslint-disable-next-line no-await-in-loop
    await reconcileLatePenalty(r.user, ymdInTz(r.date), penaltyRungs(r, r.date, sch));
  }
  for (const u of rosterUsers) {
    for (let d = periodStartFor(u, APP_LIVE_YMD); d <= yest; d = addDay(d, 1)) {
      // eslint-disable-next-line no-await-in-loop
      await reconcileAbsence(u._id, d);
    }
    for (const m of preview.months) {
      // eslint-disable-next-line no-await-in-loop
      await reconcilePerfectMonth(u._id, m);
      // eslint-disable-next-line no-await-in-loop
      await reconcileNoLeaveMonth(u._id, m);
    }
  }
  check('live functions ne ek bhi row nahi badli', fpBeforeLive === await ledgerFingerprint());

  // ── 4. Dobara dabane par ek bhi point nahi hilta ───────────────────────────
  console.log('\n4) DOBARA dabane par kuch nahi hilta (idempotent)');
  const fpAfterFirst = await ledgerFingerprint();
  const preview2 = await previewRebuild(owner);
  check('doosri baar preview bilkul saaf hai', preview2.clean === true, `${preview2.rows.length} rows bachi`);
  const result2 = await runRebuild(owner);
  const fpAfterSecond = await ledgerFingerprint();
  check('doosre apply ke baad ledger bilkul same', fpAfterFirst === fpAfterSecond);
  check('doosra apply koi badlav nahi dikhata', result2.movedCount === 0 && result2.totalDelta === 0, `moved ${result2.movedCount}, delta ${result2.totalDelta}`);
  check('doosra apply bhi verified', result2.verified === true);

  // ── 5. Lock: jab tak ek chal raha hai, doosra 409 ──────────────────────────
  console.log('\n5) Lock — ek waqt me sirf ek rebuild');
  await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.rebuildLock': 'someone-else', 'bonus.rebuildLockUntil': new Date(Date.now() + 60000) } });
  Setting.invalidateCache();
  let blocked = null;
  try { await runRebuild(owner); } catch (e) { blocked = e; }
  check('dusri koshish 409 REBUILD_BUSY se ruki', blocked?.status === 409 && blocked?.code === 'REBUILD_BUSY', blocked ? `${blocked.status} ${blocked.code}` : 'ruki hi nahi');
  // expire hone par lock khud chhoot jaana chahiye
  await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.rebuildLockUntil': new Date(Date.now() - 1000) } });
  Setting.invalidateCache();
  let afterExpiry = null;
  try { await runRebuild(owner); } catch (e) { afterExpiry = e; }
  check('expire ho chuka lock raasta nahi rokta', afterExpiry === null, afterExpiry ? `${afterExpiry.code}` : '');

  // ── 6. Sirf owner ────────────────────────────────────────────────────────
  console.log('\n6) Sirf CEO & President');
  const other = await User.findOne({ role: { $ne: 'CEO_PRESIDENT' }, isActive: true }).select('name role');
  let denied = null;
  try { await runRebuild(other); } catch (e) { denied = e; }
  check(`${other?.role} ko 403 mila`, denied?.status === 403, denied ? `${denied.status} ${denied.code}` : 'mana hi nahi kiya');

  // ── 7. AAJ ki rows ko haath na lage, aur preview unka jhootha wada na kare ──
  // 7 Oct 2026 ko ye asli dikkat aayi: Ankur aaj late aaye, −1 laga, aur preview ne kaha
  // "+1, ye penalty hat jayegi". Hatti nahi — apply jaan-boojhkar aaj ko chhodta hai (aaj
  // khatam hi nahi hua, use judge nahi kiya ja sakta). Ginti kal tak ki thi par ledger me
  // aaj ki row thi, to wo "extra" lagti thi. Owner ko ek aisa point dikha jo kabhi aata hi
  // nahi — aur apply ke baad ka verification bhi isi phantom par fail hota.
  console.log('\n7) Aaj likhi gayi rows — preview jhooth na bole, apply chhue nahi');
  const todayYMD = ymdInTz(new Date());
  const victim = rosterUsers[0];
  await PointEntry.updateOne(
    { dedupeKey: `auto_late:${victim._id}:${todayYMD}` },
    { $set: { user: victim._id, month: todayYMD.slice(0, 7), points: -1, reason: `Late arrival · ${todayYMD}`, source: 'auto_late', earnedYMD: todayYMD } },
    { upsert: true },
  );
  const prevToday = await previewRebuild(owner);
  const liesAboutToday = prevToday.rows.some((r) => r.changes.some((c) => c.on === todayYMD));
  check('preview aaj ki row ka zikr hi nahi karta', !liesAboutToday,
    liesAboutToday ? JSON.stringify(prevToday.rows.flatMap((r) => r.changes.filter((c) => c.on === todayYMD))) : 'saaf');
  const resToday = await runRebuild(owner);
  const stillThere = await PointEntry.findOne({ dedupeKey: `auto_late:${victim._id}:${todayYMD}` });
  check('apply ke baad aaj ki row abhi bhi maujood hai', !!stillThere, stillThere ? `${stillThere.points}` : 'MIT GAYI');
  check('aur rebuild khud ko verified hi batata hai', resToday.verified === true,
    resToday.verified ? '' : 'phantom par verification fail ho raha hai');
  await PointEntry.deleteOne({ dedupeKey: `auto_late:${victim._id}:${todayYMD}` });

  console.log(`\n${failures ? `❌ ${failures} check fail` : '✅ saare check pass'}\n`);
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('\n💥', e); process.exit(1); });
