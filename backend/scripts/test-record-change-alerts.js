/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * "MERE RECORD ME BADLAAV HO TO TURANT KHABAR" (idea I51, owner ka faisla 19 Nov 2026).
 *
 * Pehle: attendance.service, user.service aur bonus.service me EK BHI notify() nahi thi.
 * Leadership kisi ka check-out 18:40 se 18:00 kar de, din clear kar de (−1 absent), leave
 * quota 18 se 16 kar de, ya +5 points de de — us bande ko koi khabar nahi jaati thi. Use
 * tab pata chalta jab khud dhoondhe.
 *
 * Ab chaar cheezon par ghanti + phone push (owner ne chaaron chuni):
 *   1. attendance ka time / din clear / late "On duty"   → ATTENDANCE_CHANGED
 *   2. points mile ya kate / entry delete                → POINTS_CHANGED
 *   3. leave quota-used, aur "aapke liye leave record ki" → LEAVE_BALANCE_CHANGED / LEAVE_DECISION
 *   4. shift, grace, working days, employment type, joining date → WORK_DETAILS_CHANGED
 * Har khabar me badlav karne wale ka NAAM (owner ne haan kaha).
 *
 * Teen niyam jo yahan sabit hote hain (lib/recordAlert.js):
 *   • apne hi kiye badlav par khabar NAHI
 *   • kuch sach me na badla ho (dialog dobara save) to khabar NAHI
 *   • dobara-hisab karne wale engine (backfillMonth jaise) se EK BHI khabar nahi — warna
 *     ek holiday declare karne par poore office ke phone baj uthenge
 *
 * Run (backend folder se):  node scripts/test-record-change-alerts.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_recordalert'; // throwaway DB
process.env.VAPID_PUBLIC_KEY = 'test-public'; // nakli — web-push neeche stub hai, kuch bahar nahi jaata
process.env.VAPID_PRIVATE_KEY = 'test-private';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Role } from '../src/models/Role.js';
import { User } from '../src/models/User.js';
import { Setting } from '../src/models/Setting.js';
import { Attendance } from '../src/models/Attendance.js';
import { LeaveBalance } from '../src/models/LeaveBalance.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { Notification } from '../src/models/Notification.js';
import { PushSubscription } from '../src/models/PushSubscription.js';
import { loadRoles } from '../src/lib/roles.js';
import { SYSTEM_ROLES } from '../src/lib/permissionCatalog.js';
import { ymdInTz, companyDayFromYMD, companyDayInstantAt, dayInWords } from '../src/lib/time.js';
import { currentLeaveYear } from '../src/lib/leaveYear.js';
import * as att from '../src/services/attendance.service.js';
import * as users from '../src/services/user.service.js';
import * as leave from '../src/services/leave.service.js';
import * as bonus from '../src/services/bonus.service.js';

const DB = 'office_test_recordalert';
let failures = 0;
let total = 0;
function check(name, cond, extra = '') {
  total += 1;
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function section(title, fn) {
  console.log(`\n${title}`);
  try { await Notification.deleteMany({}); sent.length = 0; await fn(); } catch (e) { check(`${title} — crash`, false, e?.stack || e?.message); }
}

/** web-push ka bhejne wala hissa nakli: na network, na asli VAPID — bas kis endpoint par gaya. */
let sent = [];
async function stubWebPush() {
  const webpush = (await import('web-push')).default;
  sent = [];
  webpush.setVapidDetails = () => {};
  webpush.sendNotification = async (sub, body) => { sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body) }); };
  return sent;
}

const nameOf = new Map();
const byEndpoint = new Map();
/** Kin logon ki bell me row bani — naam, sorted. */
const who = async (filter = {}) => (await Notification.find(filter).select('user').lean()).map((r) => nameOf.get(String(r.user))).sort();
const pushedTo = () => sent.map((s) => byEndpoint.get(s.endpoint)).sort();
/** Ek hi row — ya null. */
const rowOf = async (filter = {}) => Notification.findOne(filter).lean();
const count = (filter = {}) => Notification.countDocuments(filter);

async function main() {
  await connectDB();
  if (!/test/i.test(mongoose.connection.name || '')) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${mongoose.connection.name}`);

  // ── Is office jaise role: owner CEO_PRESIDENT rank 1, koi CEO/DIRECTOR nahi ──
  const LEAD = SYSTEM_ROLES.find((r) => r.key === 'CEO').permissions;
  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO & President', rank: 1, permissions: LEAD },
    { key: 'TEAM', label: 'Team', rank: 10, permissions: ['markAttendance', 'applyLeave', 'downloadReports'] },
  ]);
  await loadRoles();
  // weekendDays [] — har din kaam ka din, taaki test kisi bhi din chale.
  await Setting.create({
    key: 'global', companyName: 'TestCo', weekendDays: [], workStart: '10:00', workEnd: '18:00',
    graceMinutes: 16, overtimeAfterMinutes: 60, annualLeaveQuota: 18, rolesSchemaVersion: 2,
    bonus: { enabled: true, rupeesPerPoint: 100, autoRules: [{ key: 'lateArrival', points: -1 }] },
  });
  Setting.invalidateCache();

  const joined = new Date('2026-06-01T00:00:00+05:30');
  const mk = async (name, role, extra = {}) => {
    const tag = name.replace(/\W+/g, '').toLowerCase();
    const u = await User.create({ name, email: `${tag}@t.co`, passwordHash: 'x', role, employeeId: `RA-${tag}`, isActive: true, dateOfJoining: joined, ...extra });
    nameOf.set(String(u._id), name);
    const endpoint = `https://push.test/${tag}`;
    await PushSubscription.create({ user: u._id, endpoint, keys: { p256dh: 'k', auth: 'a' } });
    byEndpoint.set(endpoint, name);
    return u;
  };
  const K = await mk('Khaan Aamir', 'CEO_PRESIDENT');
  const S = await mk('Kalpana Saini', 'CEO_PRESIDENT');
  const anjali = await mk('Anjali Singh', 'TEAM');
  const other = await mk('Priyanshi Patel', 'TEAM');

  await stubWebPush();

  // Aaj se 20 din peeche — 'today'/'yesterday' wale shabd se bachne ke liye.
  const D = ymdInTz(new Date(Date.now() - 20 * 86400000));
  const D2 = ymdInTz(new Date(Date.now() - 19 * 86400000));
  const D3 = ymdInTz(new Date(Date.now() - 18 * 86400000));
  const DAY = companyDayFromYMD(D);
  const at = (ymd, hm) => companyDayInstantAt(companyDayFromYMD(ymd), hm);

  await section('TEST 1 — leadership ne check-out badla → Anjali ko ghanti + phone push', async () => {
    // Pehle ek asli din bana do (09:35–18:40), phir check-out 18:00 kar do.
    await Attendance.create({ user: anjali._id, date: DAY, status: 'PRESENT', checkInAt: at(D, '09:35'), checkOutAt: at(D, '18:40') });
    await att.setAttendanceRecord(anjali._id, D, '09:35', '18:00', S);
    const got = await who();
    check('khabar SIRF Anjali ko gayi (bug me kisi ko nahi)', same(got, ['Anjali Singh']), JSON.stringify(got));
    const row = await rowOf();
    check('type', row?.type === 'ATTENDANCE_CHANGED', row?.type);
    check('title', row?.title === 'Attendance changed', row?.title);
    check('message me pehle → ab, aur kisne', row?.message === `Your attendance for ${dayInWords(D)} was changed — check-out 18:40 → 18:00 · by Kalpana Saini`, row?.message);
    check('link employee khol sakta hai (/attendance)', row?.link === '/attendance', row?.link);
    check('entity = usi din ki row (dobara badlav phone par wahi notification badlega)', row?.entityType === 'Attendance' && !!row?.entityId);
    check('phone push bhi Anjali ko', same(pushedTo(), ['Anjali Singh']), JSON.stringify(pushedTo()));
  });

  await section('TEST 2 — wahi values dobara save → KUCH NAHI jaata', async () => {
    await att.setAttendanceRecord(anjali._id, D, '09:35', '18:00', S);
    check('koi nayi ghanti nahi', (await count()) === 0, String(await count()));
    check('koi push nahi', sent.length === 0, String(sent.length));
  });

  await section('TEST 3 — check-in badla jisse din LATE ho gaya → wo bhi likha ho', async () => {
    await att.setAttendanceRecord(anjali._id, D, '12:20', '18:00', S);
    const row = await rowOf();
    check('message me time + "day now late"', row?.message === `Your attendance for ${dayInWords(D)} was changed — check-in 09:35 → 12:20, day now late · by Kalpana Saini`, row?.message);
  });

  await section('TEST 4 — naya din leadership ne banaya (pehle kuch nahi tha)', async () => {
    await att.setAttendanceRecord(anjali._id, D2, '09:50', '18:30', K);
    const row = await rowOf();
    check('title "Attendance recorded"', row?.title === 'Attendance recorded', row?.title);
    check('message me dono time, bina teer ke', row?.message === `Your attendance for ${dayInWords(D2)} was recorded — check-in 09:50, check-out 18:30 · by Khaan Aamir`, row?.message);
  });

  await section('TEST 5 — din clear kar diya (absent) → "the day was …"', async () => {
    await att.setAttendanceRecord(anjali._id, D2, '', '', K);
    const row = await rowOf();
    check('title "Attendance cleared"', row?.title === 'Attendance cleared', row?.title);
    check('message me purana din likha ho', row?.message === `Your attendance for ${dayInWords(D2)} was cleared — the day was 09:50–18:30 · by Khaan Aamir`, row?.message);
  });

  await section('TEST 6 — jo din pehle se khaali tha use clear karna → KUCH NAHI', async () => {
    await att.setAttendanceRecord(anjali._id, D3, '', '', K);
    check('koi ghanti nahi (kuch badla hi nahi)', (await count()) === 0, String(await count()));
  });

  await section('TEST 7 — apna hi record badla (actor = wahi banda) → KUCH NAHI', async () => {
    await att.setAttendanceRecord(anjali._id, D, '10:00', '18:00', anjali);
    check('apne hi phone par ping nahi', (await count()) === 0, String(await count()));
  });

  await section('TEST 8 — purane test script (bina actor, 4 argument) → chalta hai, bas naam nahi', async () => {
    await att.setAttendanceRecord(anjali._id, D, '09:35', '18:05');
    const row = await rowOf();
    check('khabar phir bhi gayi', !!row);
    check('message me "by" nahi', !!row && !/ · by /.test(row.message), row?.message);
  });

  await section('TEST 9 — late ko "On duty" maana, phir hataya; dobara karne par kuch nahi', async () => {
    await att.setAttendanceRecord(anjali._id, D, '12:20', '18:00', S);
    await Notification.deleteMany({});
    const rec = await Attendance.findOne({ user: anjali._id, date: DAY });
    await att.excuseLate(K, rec._id, true);
    let row = await rowOf();
    check('title "Late marked On duty"', row?.title === 'Late marked On duty', row?.title);
    check('message', row?.message === `Your late arrival for ${dayInWords(D)} is now On duty — it no longer counts against you · by Khaan Aamir`, row?.message);
    await Notification.deleteMany({});
    await att.excuseLate(K, rec._id, true); // dobara wahi
    check('dobara excuse karne par kuch nahi', (await count()) === 0, String(await count()));
    await att.excuseLate(K, rec._id, false);
    row = await rowOf();
    check('un-excuse par "On duty removed"', row?.title === 'On duty removed', row?.title);
    check('…aur "the late counts again"', /the late counts again/.test(row?.message || ''), row?.message);
  });

  await section('TEST 10 — leave quota / used badla', async () => {
    await leave.setLeaveBalance(K, anjali._id, { totalQuota: 16, used: 3 });
    const row = await rowOf();
    check('khabar sirf Anjali ko', same(await who(), ['Anjali Singh']));
    check('type', row?.type === 'LEAVE_BALANCE_CHANGED', row?.type);
    check('title', row?.title === 'Leave balance changed', row?.title);
    check('message me quota aur used, dono', row?.message === 'Your leave balance was changed — quota 18 → 16, used 0 → 3 · by Khaan Aamir', row?.message);
    check('link /leaves', row?.link === '/leaves', row?.link);
    await Notification.deleteMany({});
    await leave.setLeaveBalance(K, anjali._id, { totalQuota: 16, used: 3 }); // wahi values
    check('wahi values dobara → kuch nahi', (await count()) === 0, String(await count()));
  });

  await section('TEST 11 — shift / grace / working days / employment type badle', async () => {
    await users.updateUser(K, String(anjali._id), { employmentType: 'PART_TIME', schedule: { workStart: '09:30', workEnd: '18:00', graceMinutes: 10, workDays: [1, 2, 3, 4, 5] } });
    const row = await rowOf();
    check('type', row?.type === 'WORK_DETAILS_CHANGED', row?.type);
    check('title', row?.title === 'Your work details changed', row?.title);
    check('message me shift, grace, working days, employment type', row?.message === 'Your work details were changed — shift 10:00–18:00 → 09:30–18:00, grace 16 min → 10 min, working days office default → Mon, Tue, Wed, Thu, Fri, employment type Full-time → Part-time · by Khaan Aamir', row?.message);
  });

  await section('TEST 12 — sirf phone number badla → KUCH NAHI (naam/department bhi nahi)', async () => {
    await users.updateUser(K, String(anjali._id), { phone: '9999999999', department: 'Civil' });
    check('koi ghanti nahi', (await count()) === 0, String(await count()));
  });

  await section('TEST 13 — joining date badli → wo aur uske saath chhupa leave-quota badlav bhi', async () => {
    // Quota apne aap tabhi badalta hai jab balance ki row pehle se ho AUR usme wahi figure
    // ho jo purani joining date se banta tha (haath se set kiya figure zinda rehta hai —
    // user.service ka niyam). Isliye row pehle bana rahe hain.
    await LeaveBalance.create({ user: other._id, year: currentLeaveYear(), totalQuota: 18, used: 0, remaining: 18 });
    await users.updateUser(K, String(other._id), { dateOfJoining: '2026-09-01' });
    const row = await rowOf();
    check('khabar Priyanshi ko', same(await who(), ['Priyanshi Patel']));
    check('joining date ka pehle → ab', /joining date 1 Jun 2026 → 1 Sep 2026/.test(row?.message || ''), row?.message);
    check('leave quota ka chhupa badlav bhi likha', /leave quota 18 → /.test(row?.message || ''), row?.message);
  });

  await section('TEST 14 — manual points mile aur kate', async () => {
    await bonus.awardManual(S, { userId: String(anjali._id), points: 5, reason: 'Client appreciation' });
    let row = await rowOf();
    check('type', row?.type === 'POINTS_CHANGED', row?.type);
    check('title "Points added"', row?.title === 'Points added', row?.title);
    check('message', row?.message === `5 points added for ${new Date().toISOString().slice(0, 7).replace(/^(\d{4})-(\d{2})$/, (m, y, mo) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mo) - 1] + ' ' + y)} — Client appreciation · by Kalpana Saini`, row?.message);
    check('link /rewards', row?.link === '/rewards', row?.link);
    await Notification.deleteMany({});
    await bonus.awardManual(S, { userId: String(anjali._id), points: -3, reason: 'Site report late' });
    row = await rowOf();
    check('kat-ne par title "Points deducted"', row?.title === 'Points deducted', row?.title);
    check('…aur ginti bina minus ke, shabd se saaf', /^3 points deducted for /.test(row?.message || ''), row?.message);
  });

  await section('TEST 15 — CEO ne points ki entry delete ki → jiski thi use khabar', async () => {
    const entry = await PointEntry.create({ user: anjali._id, month: ymdInTz(new Date()).slice(0, 7), earnedYMD: ymdInTz(new Date()), points: 5, reason: 'Client appreciation', source: 'manual', awardedBy: S._id });
    await Notification.deleteMany({});
    await bonus.removeEntry(K, String(entry._id));
    const row = await rowOf();
    check('khabar Anjali ko', same(await who(), ['Anjali Singh']));
    check('title', row?.title === 'Points entry removed', row?.title);
    check('message me kya hata, saaf likha', /A points entry was removed from .* — \+5 Client appreciation · by Khaan Aamir/.test(row?.message || ''), row?.message);
  });

  await section('TEST 16 — leadership ne Anjali ke liye leave record ki → "recorded for you", kisne bhi', async () => {
    const d1 = ymdInTz(new Date(Date.now() + 15 * 86400000));
    await leave.recordLeaveForUser(K, String(anjali._id), { type: 'SICK', startYMD: d1, endYMD: d1, reason: 'bukhar' });
    const rows = await Notification.find({}).lean();
    check('sirf EK khabar (do push nahi)', rows.length === 1, String(rows.length));
    check('title "Leave recorded for you" (pehle "Leave approved" likha aata tha)', rows[0]?.title === 'Leave recorded for you', rows[0]?.title);
    check('message me "recorded for you" aur naam', /was recorded for you · by Khaan Aamir$/.test(rows[0]?.message || ''), rows[0]?.message);
    check('phone push bhi Anjali ko', same(pushedTo(), ['Anjali Singh']), JSON.stringify(pushedTo()));
  });

  await section('TEST 17 — apni khud ki leave approve hui → purana wala text waisa hi (kuch nahi toota)', async () => {
    const d2 = ymdInTz(new Date(Date.now() + 25 * 86400000));
    const lr = await leave.applyLeave(anjali, { type: 'CASUAL', startYMD: d2, endYMD: d2, reason: 'ghar ka kaam' });
    await Notification.deleteMany({}); // approvers ki "New leave request" hata do
    await leave.decideLeave(K, lr.id, 'APPROVE', '');
    const row = await rowOf({ user: anjali._id });
    check('title purana hi — "Leave approved"', row?.title === 'Leave approved', row?.title);
    check('message purana hi (koi "by" nahi)', row?.message === 'Your casual leave (1 day(s)) was approved', row?.message);
  });

  await section('TEST 18 — ENGINE se EK BHI khabar nahi (backfillMonth poora mahina dobara likhta hai)', async () => {
    const month = D.slice(0, 7);
    await bonus.backfillMonth(month);
    check('backfillMonth ne koi ghanti nahi bheji', (await count()) === 0, String(await count()));
    check('…aur koi push bhi nahi', sent.length === 0, String(sent.length));
    await att.recomputeAllOvertime({ userId: anjali._id });
    check('recomputeAllOvertime ne bhi kuch nahi bheja', (await count()) === 0, String(await count()));
  });
}

main()
  .then(async () => {
    console.log(`\n${failures ? `❌ ${failures} / ${total} FAIL` : `✅ SAB PAAS — ${total} / ${total}`}`);
    if (mongoose.connection.name === DB) await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(failures ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(e);
    if (mongoose.connection.name === DB) await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(1);
  });
