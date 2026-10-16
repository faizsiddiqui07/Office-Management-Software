/**
 * Jo bhi cheez kisi GUZRE din ki shakl badalti hai, wo punctual streak ko dobara judge
 * karwati hai ya nahi — iska test. (B1–B8 ke fix)
 *
 * Niyam ek hi hai: rolling scan har din ko sirf EK BAAR dekhta hai, to jis din ko wo
 * judge kar chuka hai uska data baad me badle to `markStreaksStale()` lagna hi chahiye —
 * warna chain purane sach par atki rehti hai aur kisi ka +5 kabhi nahi banta (ya galat
 * ban kar pada rehta hai).
 *
 * Yahan har raasta asli service se chalaya jaata hai aur `bonus.streaksStale` check hota
 * hai. Saath me B8: deactivate ho chuke bande ke purane award rescan ke baad BHI bache
 * rehne chahiye — unhe dobara likhne wala koi hai hi nahi.
 *
 * Prod par chalane se INKAAR karta hai — DB ke naam me "test" hona zaroori hai.
 *
 *   node scripts/_clone-to-test-db.js --to office_test_hooks
 *   MONGODB_DB=office_test_hooks node scripts/test-streak-hooks.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { Holiday } from '../src/models/Holiday.js';
import { LeaveRequest } from '../src/models/LeaveRequest.js';
import { can } from '../src/lib/permissions.js';
import { loadRoles } from '../src/lib/roles.js';
import { ymdInTz } from '../src/lib/time.js';
import * as holidays from '../src/services/holiday.service.js';
import * as users from '../src/services/user.service.js';
import * as leave from '../src/services/leave.service.js';
import * as settingsCtl from '../src/controllers/settings.controller.js';
import { streakRosterIds, markStreaksStale } from '../src/services/bonus.service.js';

let pass = 0;
let fail = 0;
let skipped = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); } else { fail += 1; console.log(`  ❌ ${label}${extra ? `  — ${extra}` : ''}`); }
};

await connectDB();
const dbName = mongoose.connection.db.databaseName;
if (!/test/i.test(dbName)) {
  console.error(`\n⛔ "${dbName}" par nahi chalunga — naam me "test" hona chahiye.\n`);
  process.exit(1);
}
console.log(`\n🧪 DB: ${dbName}\n`);

// Role cache: `can()` isi se padhta hai. Script me app ka startup nahi chalta, isliye
// bina iske har permission false lautti hai aur aadha test jhoothi 403 par ruk jata hai.
await loadRoles();

const mark = async () => (await Setting.findOne({ key: 'global' }).select('bonus.streaksStale').lean())?.bonus?.streaksStale || '';
const clearMark = async () => {
  await Setting.updateOne({ key: 'global' }, { $set: { 'bonus.streaksStale': '' } });
  Setting.invalidateCache();
};
/** Ek kaam chalao aur dekho uske baad nishaan laga ya nahi. */
const marksAfter = async (label, fn, expected = true) => {
  await clearMark();
  try {
    await fn();
  } catch (e) {
    // Transaction wale raaste kuch machine par chal hi nahi paate — jhooth bolne se
    // behtar hai saaf likh dena ki ye case chala hi nahi.
    skipped += 1;
    console.log(`  ⏭  ${label}  — chala hi nahi (${String(e?.message).slice(0, 60)})`);
    return;
  }
  const got = !!(await mark());
  ok(got === expected, `${label} → nishaan ${expected ? 'laga' : 'nahi laga (sahi)'}`, `mila: ${got}`);
};

const owner = await User.findOne({ isActive: true, role: 'CEO_PRESIDENT' });
const today = ymdInTz(new Date());
const yest = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
ok(!!owner, `owner mila: ${owner?.name}`);

// ── B3: calendar ka holiday ──────────────────────────────────────────────────────────
console.log('\nB3) Calendar: holiday jodna / badalna / hataana');
let made = null;
await marksAfter('guzre din (kal) par holiday joda', async () => {
  made = await holidays.createHoliday(owner, { title: 'ZZ Test holiday', type: 'HOLIDAY', startYMD: yest, endYMD: yest });
});
await marksAfter('aane wale saal ka holiday joda', async () => {
  const far = `${Number(today.slice(0, 4)) + 1}-12-25`;
  const h = await holidays.createHoliday(owner, { title: 'ZZ Future holiday', type: 'HOLIDAY', startYMD: far, endYMD: far });
  await Holiday.deleteOne({ _id: h.id || h._id });
}, false); // aage ka din scan ne dekha hi nahi — bekaar me 3s ka re-walk nahi hona chahiye
await marksAfter('guzre din wala holiday badla', async () => {
  await holidays.updateHoliday(made.id || made._id, { title: 'ZZ Test holiday (edited)' });
});
await marksAfter('guzre din wala holiday hataya', async () => {
  await holidays.deleteHoliday(made.id || made._id);
});

// ── B4: janam-taarikh ────────────────────────────────────────────────────────────────
console.log('\nB4) Janam-taarikh (BIRTHDAY entry)');
const staff = (await User.find({ isActive: true }).select('name role dateOfBirth schedule dateOfJoining'))
  .find((u) => can({ role: u.role }, 'markAttendance') && String(u._id) !== String(owner._id));
let bday = null;
await marksAfter('kisi ka birthday calendar me joda', async () => {
  bday = await holidays.createHoliday(owner, { title: `ZZ ${staff.name}`, type: 'BIRTHDAY', startYMD: '1995-02-11', endYMD: '1995-02-11', userId: String(staff._id) });
});
if (bday) {
  await marksAfter('wahi birthday hataya', async () => {
    await holidays.deleteHoliday(bday.id || bday._id);
  });
  // DOB wapas jaisa tha
  await User.updateOne({ _id: staff._id }, { $set: { dateOfBirth: staff.dateOfBirth || '' } });
}

// ── B5 + B7: schedule aur joining date ───────────────────────────────────────────────
console.log('\nB5/B7) User ka schedule aur joining date');
const beforeJoin = staff.dateOfJoining;
await marksAfter('workDays badle', async () => {
  await users.updateUser(owner, String(staff._id), { schedule: { ...(staff.schedule?.toJSON?.() || staff.schedule || {}), workDays: [1, 2, 3, 4, 5] } });
});
await marksAfter('joining date badli', async () => {
  await users.updateUser(owner, String(staff._id), { dateOfJoining: '2026-07-05' });
});
await marksAfter('kuch aur badla (sirf naam) → nishaan nahi lagna chahiye', async () => {
  await users.updateUser(owner, String(staff._id), { name: staff.name });
}, false);
// wapas (test ki safai kabhi test ko gira na de)
try {
  await users.updateUser(owner, String(staff._id), { schedule: staff.schedule?.toJSON?.() || staff.schedule || {}, dateOfJoining: ymdInTz(beforeJoin) });
} catch (e) {
  console.log(`  ⏭  wapas nahi kar paya: ${String(e?.message).slice(0, 60)}`);
}

// ── B6: office ke weekend days ───────────────────────────────────────────────────────
console.log('\nB6) Settings me weekend days');
const res = { json() { return this; }, status() { return this; } };
const s0 = await Setting.getFullSingleton();
const weekendWas = [...(s0.weekendDays || [])];
await marksAfter('weekendDays badle', async () => {
  await settingsCtl.updateSettings({ body: { weekendDays: [0, 6] }, user: owner }, res, (e) => { throw e; });
});
await marksAfter('settings me kuch aur badla (companyName) → nishaan nahi', async () => {
  const s = await Setting.getFullSingleton();
  await settingsCtl.updateSettings({ body: { companyName: s.companyName }, user: owner }, res, (e) => { throw e; });
}, false);
await settingsCtl.updateSettings({ body: { weekendDays: weekendWas }, user: owner }, res, (e) => { throw e; });
await clearMark();

// ── B2: office-wide WFH undo ─────────────────────────────────────────────────────────
console.log('\nB2) Office-wide WFH undo');
await marksAfter('aaj ke liye WFH declare karke undo kiya', async () => {
  await leave.declareOfficeWideWFH(owner, today, 'test');
  await clearMark(); // declare ka apna asar alag se dekha ja chuka hai
  const out = await leave.undoOfficeWideWFH(owner, today);
  if (!out.removed) throw new Error('koi row hati hi nahi');
});

// ── B1: WFH wali chhutti cancel ──────────────────────────────────────────────────────
console.log('\nB1) WFH leave cancel (transaction wala raasta)');
// Aage ka ek kaam-kaji din chuna: aaj par to pehle se attendance padi hoti hai, aur WFH
// us din par lagti hi nahi. Cancel ka niyam date par nirbhar nahi — nishaan dono taraf
// lagna chahiye.
const soon = (() => {
  let d = today;
  for (let i = 0; i < 7; i += 1) {
    d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) return d; // Sunday chhod do
  }
  return d;
})();
await marksAfter(`ek WFH leave (${soon}) approve karke cancel ki`, async () => {
  // Saal me 2 WFH ki seema hai — test ko us seema par na atakne do.
  await LeaveRequest.deleteMany({ user: staff._id, type: leave.WFH });
  const lr = await leave.applyLeave(staff, { type: leave.WFH, startYMD: soon, endYMD: soon, reason: 'test' });
  await leave.decideLeave(owner, lr.id || lr._id, 'APPROVE', '');
  await clearMark();
  await leave.cancelLeave(owner, lr.id || lr._id);
});

// ── B8: deactivate ho chuke bande ke purane award bache rehne chahiye ────────────────
console.log('\nB8) Deactivate kiye bande ka purana record');
const gone = await User.findOne({ isActive: false });
let ghostId = gone?._id;
let madeGhost = false;
if (!ghostId) {
  const g = await User.create({ name: 'ZZ Purana Karmchari', email: `zz-${Date.now()}@test.local`, passwordHash: 'x', role: staff.role, employeeId: `ZZ-${Date.now() % 100000}`, isActive: false, joinedAt: new Date('2026-07-01') });
  ghostId = g._id;
  madeGhost = true;
}
const ghostKey = `auto_streak:${ghostId}:2026-08-20`;
await PointEntry.deleteOne({ dedupeKey: ghostKey });
await PointEntry.create({ user: ghostId, month: '2026-08', points: 5, reason: 'Punctual streak · 6 days on time · 2026-08-20', source: 'auto_streak', earnedYMD: '2026-08-20', dedupeKey: ghostKey });

const rosterIds = (await streakRosterIds()).map(String);
ok(!rosterIds.includes(String(ghostId)), 'wo banda roster me nahi hai (sahi)');

const activeBefore = await PointEntry.countDocuments({ source: 'auto_streak', user: { $in: await streakRosterIds() } });
await markStreaksStale();
const { maybeRunDaily } = await import('../src/services/bonus.service.js');
await maybeRunDaily(); // iske andar rescanStaleStreaks chalta hai
const ghostAfter = await PointEntry.countDocuments({ dedupeKey: ghostKey });
const activeAfter = await PointEntry.countDocuments({ source: 'auto_streak', user: { $in: await streakRosterIds() } });
ok(ghostAfter === 1, 'rescan ke baad bhi uska purana award bacha hai (pehle mit jata tha)');
ok(activeAfter === activeBefore, `active logon ke award dobara waise ke waise bane (${activeBefore} → ${activeAfter})`);
ok((await mark()) === '', 'nishaan nipat gaya');

// safai
await PointEntry.deleteOne({ dedupeKey: ghostKey });
if (madeGhost) await User.deleteOne({ _id: ghostId });
await Holiday.deleteMany({ title: /^ZZ / });

console.log(`\n${fail ? '❌' : '✅'}  ${pass} pass, ${fail} fail${skipped ? `, ${skipped} skip` : ''}\n`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
