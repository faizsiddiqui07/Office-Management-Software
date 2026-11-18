/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * ATTENDANCE CORRECTION KI GHANTI KISI TAK NAHI PAHUNCHTI THI (pakda 18 Nov 2026).
 *
 * createRequest "leadership" ko ghanti bhejta tha:
 *     User.find({ role: { $in: LEADERSHIP } })      // LEADERSHIP = ['CEO', 'DIRECTOR']
 * Ye seed role is office me ab hain hi nahi (go-live se pehle haath se hata diye gaye;
 * owner role CEO_PRESIDENT hai). To go-live (1 Jul 2026) se ghanti KISI ko nahi jaati thi:
 * na row, na phone push, na error. Banda sunta tha "leadership will review it", aur approver
 * ko correction sirf tab dikhta jab wo khud dhoondhe — Attendance → Corrections tab, aur
 * 18/22 Jul ke baad Attendance/Approvals ka laal dot.
 *
 * Ab: jinke role me approveRegularization hai (wahi log jo approve kar sakte hain),
 * maangne wale ko chhod kar. Koi role na rakhe to CEO & President.
 *
 * Saath me leave ka backup (owner ka faisla, 18 Nov): kisi role ke paas approveLeave na
 * ho to request ['CEO','DIRECTOR'] (yaani kisi ko nahi) ki jagah ab CEO & President ko.
 *
 * Check-in alert aur shaam ka digest JAAN-BOOJH KAR NAHI chhede — owner ne unhe band hi
 * rehne diya. Wo is test ka hissa nahi.
 *
 * Purane test ye kabhi nahi pakad paaye: test-late-ladder createRequest chalata tha (aur
 * wahan bhi role isi office jaise the), par kisi test ne kabhi check hi nahi kiya ki ghanti
 * KISE gayi. Yahan role ISI office jaise hain — CEO_PRESIDENT rank 1, koi CEO/DIRECTOR nahi —
 * aur har raaste par naam-ba-naam dekha jaata hai ki bell aur phone push kise mila.
 *
 * Run (backend folder se):  node scripts/test-correction-alerts.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_corralerts'; // throwaway DB
process.env.VAPID_PUBLIC_KEY = 'test-public'; // nakli — web-push neeche stub hai, kuch bahar nahi jaata
process.env.VAPID_PRIVATE_KEY = 'test-private';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Role } from '../src/models/Role.js';
import { User } from '../src/models/User.js';
import { Setting } from '../src/models/Setting.js';
import { Notification } from '../src/models/Notification.js';
import { PushSubscription } from '../src/models/PushSubscription.js';
import { loadRoles, ownerRoleKeys, rolesWithPermission, rolesToNotifyFor } from '../src/lib/roles.js';
import { can } from '../src/lib/permissions.js';
import { SYSTEM_ROLES } from '../src/lib/permissionCatalog.js';
import { ymdInTz, companyDayFromYMD, dayOfWeekInTz } from '../src/lib/time.js';
import * as reg from '../src/services/regularization.service.js';
import { applyLeave } from '../src/services/leave.service.js';

const DB = 'office_test_corralerts';
let failures = 0;
let total = 0;
function check(name, cond, extra = '') {
  total += 1;
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Har section alag — ek crash baaki ko na roke (ablation isi par tika hai). */
async function section(title, fn) {
  console.log(`\n${title}`);
  try { await fn(); } catch (e) { check(`${title} — crash`, false, e?.stack || e?.message); }
}

/** web-push ka bhejne wala hissa nakli: na network, na asli VAPID — bas kis endpoint par gaya. */
async function stubWebPush() {
  const webpush = (await import('web-push')).default;
  const sent = [];
  webpush.setVapidDetails = () => {};
  webpush.sendNotification = async (sub, body) => { sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body) }); };
  return sent;
}

const nameOf = new Map(); // userId -> naam
const byEndpoint = new Map(); // push endpoint -> naam
/** Kin logon ki bell me ye row bani — naam, sorted (duplicate bhi dikhega). */
const who = async (filter) => (await Notification.find(filter).select('user').lean()).map((r) => nameOf.get(String(r.user))).sort();
/** Kin logon ke phone par push gaya. */
const pushedTo = (sent) => sent.map((s) => byEndpoint.get(s.endpoint)).sort();

/** Poore DB ki ungli-chhaap — "aur kuch to nahi badla?" ke liye. */
async function fingerprint() {
  const db = mongoose.connection.db;
  const out = {};
  for (const { name } of await db.listCollections().toArray()) {
    out[name] = JSON.stringify(await db.collection(name).find({}).sort({ _id: 1 }).toArray());
  }
  return out;
}
const changed = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => (a[k] ?? '[]') !== (b[k] ?? '[]')).sort();

async function main() {
  await connectDB();
  if (!/test/i.test(mongoose.connection.name || '')) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${mongoose.connection.name}`);

  // ── Is office jaise role. Owner tier = CEO_PRESIDENT (rank 1). CEO / DIRECTOR nahi. ──
  // Permission sets andaaze hain (asli Roles page DB me hai) — par aise chune hain ki har
  // galat design alag dikhe: Executive Manager aur Admin Office correction approve kar
  // sakte hain, BP Team sirf leave.
  const LEAD = SYSTEM_ROLES.find((r) => r.key === 'CEO').permissions; // sab, siwaay manageDues/markAttendance/applyLeave
  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO & President', rank: 1, permissions: LEAD },
    { key: 'EXECUTIVE_MANAGER', label: 'Executive Manager', rank: 2, permissions: ['viewEveryone', 'approveRegularization', 'leadershipDashboard', 'downloadReports'] },
    { key: 'ADMIN_MANAGER_OFFICE', label: 'Admin Manager (Office)', rank: 3, permissions: ['markAttendance', 'applyLeave', 'viewEveryone', 'approveRegularization', 'downloadReports'] },
    { key: 'TEAM', label: 'Team', rank: 10, permissions: ['markAttendance', 'applyLeave', 'downloadReports'] },
    { key: 'BP_TEAM', label: 'BP Team', rank: 12, permissions: ['applyLeave', 'approveLeave', 'downloadReports'] },
    { key: 'OFFICE_BOY', label: 'Office Boy', rank: 15, permissions: ['markAttendance', 'applyLeave'] },
  ]);
  await loadRoles();
  await Setting.create({ key: 'global', companyName: 'TestCo', weekendDays: [0], rolesSchemaVersion: 2 });
  Setting.invalidateCache();

  const joined = new Date('2026-06-01T00:00:00+05:30'); // go-live se pehle — poora leave quota
  const mk = async (name, role, isActive = true) => {
    const tag = name.replace(/\W+/g, '').toLowerCase();
    const u = await User.create({ name, email: `${tag}@t.co`, passwordHash: 'x', role, employeeId: `CA-${tag}`, isActive, dateOfJoining: joined });
    nameOf.set(String(u._id), name);
    const endpoint = `https://push.test/${tag}`;
    await PushSubscription.create({ user: u._id, endpoint, keys: { p256dh: 'k', auth: 'a' } });
    byEndpoint.set(endpoint, name);
    return u;
  };
  const K = await mk('Khaan Aamir', 'CEO_PRESIDENT');
  await mk('Kalpana Saini', 'CEO_PRESIDENT');
  await mk('Old Owner', 'CEO_PRESIDENT', false); // deactivated — kuch nahi milna chahiye
  await mk('Exec Manager', 'EXECUTIVE_MANAGER');
  const A = await mk('Admin Office', 'ADMIN_MANAGER_OFFICE');
  const T1 = await mk('Team One', 'TEAM');
  const T2 = await mk('Team Two', 'TEAM');
  await mk('BP Three', 'BP_TEAM');
  const O = await mk('Office Boy', 'OFFICE_BOY');
  await mk('Team Gone', 'TEAM', false);

  const sent = await stubWebPush();
  const APPROVERS = ['Admin Office', 'Exec Manager', 'Kalpana Saini', 'Khaan Aamir'];
  const OWNERS = ['Kalpana Saini', 'Khaan Aamir'];
  let r1;
  let r2;

  await section('TEST 0 — fixture sahi hai (warna baaki sab bemaani)', async () => {
    check('owner tier = sirf CEO_PRESIDENT', same(ownerRoleKeys(), ['CEO_PRESIDENT']), JSON.stringify(ownerRoleKeys()));
    check('koi CEO / DIRECTOR role nahi (is office jaisa)', !(await Role.exists({ key: { $in: ['CEO', 'DIRECTOR'] } })));
    check('correction approve karne wale role: CEO_PRESIDENT, EXECUTIVE_MANAGER, ADMIN_MANAGER_OFFICE',
      same(rolesWithPermission('approveRegularization').sort(), ['ADMIN_MANAGER_OFFICE', 'CEO_PRESIDENT', 'EXECUTIVE_MANAGER']),
      JSON.stringify(rolesWithPermission('approveRegularization')));
    check('CEO & President attendance nahi lagate', can({ role: 'CEO_PRESIDENT' }, 'markAttendance') === false);
    check('rolesToNotifyFor = jinke paas permission hai', same(rolesToNotifyFor('approveRegularization').sort(), ['ADMIN_MANAGER_OFFICE', 'CEO_PRESIDENT', 'EXECUTIVE_MANAGER']));
  });

  await section('TEST 1 — Team One correction maangta hai → approve karne walon ki bell + phone', async () => {
    sent.length = 0;
    const before = await fingerprint();
    r1 = await reg.createRequest(T1, { dateYMD: '2026-11-16', checkIn: '09:30', checkOut: '18:00', reason: 'check-out bhool gaya' });
    const after = await fingerprint();
    const got = await who({ type: 'REGULARIZATION', entityType: 'Regularization', entityId: r1.id });
    // PURANA code yahan [] par khada hota tha — yahi bug tha.
    check('ghanti KISI ko to gayi (bug me 0 thi)', got.length > 0, `${got.length}`);
    check('theek ye chaar: Admin Office, Exec Manager, Kalpana Saini, Khaan Aamir — har ek ko EK', same(got, APPROVERS), JSON.stringify(got));
    check('deactivated "Old Owner" ko kuch nahi', !got.includes('Old Owner'));
    check('maangne wale (Team One) ko khud ki ghanti nahi', !got.includes('Team One'));
    check('BP Three (sirf leave approve karta hai) ko nahi', !got.includes('BP Three'));
    const row = await Notification.findOne({ type: 'REGULARIZATION', entityId: r1.id }).lean();
    check('title', row?.title === 'Team One requested an attendance correction', row?.title);
    check('message', row?.message === 'For 2026-11-16', row?.message);
    check('link → Approvals ka corrections hissa', row?.link === '/approvals?kind=regularizations', row?.link);
    check('anpadhi (isRead false)', row?.isRead === false);
    check('phone push bhi unhi chaar ko', same(pushedTo(sent), APPROVERS), JSON.stringify(pushedTo(sent)));
    check('push ka tag = isi request ka (dobara aaye to wahi badle)', sent.every((s) => s.payload.tag === `Regularization:${r1.id}`), JSON.stringify(sent.map((s) => s.payload.tag)));
    check('DB me bas notifications + regularizations badle, aur kuch nahi', same(changed(before, after), ['notifications', 'regularizations']), JSON.stringify(changed(before, after)));
    check('request PENDING', r1.status === 'PENDING', r1.status);
  });

  await section('TEST 2 — Admin Office (khud approver, khud attendance lagata hai) correction maange', async () => {
    sent.length = 0;
    r2 = await reg.createRequest(A, { dateYMD: '2026-11-16', checkIn: '09:40', reason: 'phone band tha' });
    const got = await who({ type: 'REGULARIZATION', entityType: 'Regularization', entityId: r2.id });
    check('Admin Office ko apni hi request ki ghanti NAHI (wo khud decide kar hi nahi sakta)', !got.includes('Admin Office'), JSON.stringify(got));
    check('baaki teen approvers ko', same(got, ['Exec Manager', 'Kalpana Saini', 'Khaan Aamir']), JSON.stringify(got));
    check('phone push bhi wahi teen', same(pushedTo(sent), ['Exec Manager', 'Kalpana Saini', 'Khaan Aamir']), JSON.stringify(pushedTo(sent)));
  });

  await section('TEST 3 — banda request wapas le → sabki bell se hat jaaye', async () => {
    await reg.withdraw(T1, r1.id);
    check('r1 ki ghanti ab kisi ki bell me nahi', (await Notification.countDocuments({ type: 'REGULARIZATION', entityId: r1.id })) === 0);
    check('r2 ki teeno ghantiyan waisi hi', (await Notification.countDocuments({ type: 'REGULARIZATION', entityId: r2.id })) === 3);
  });

  await section('TEST 4 — Khaan Aamir reject kare → sabki bell saaf, maangne wale ko jawab', async () => {
    await reg.decide(K, r2.id, 'REJECTED', 'nahi');
    check('r2 ki ghanti ab kisi ki bell me nahi (jinhone kuch nahi kiya unki bhi)', (await Notification.countDocuments({ type: 'REGULARIZATION', entityId: r2.id })) === 0);
    const dec = await who({ type: 'REGULARIZATION_DECISION' });
    check('faisle ki khabar sirf Admin Office ko', same(dec, ['Admin Office']), JSON.stringify(dec));
  });

  await section('TEST 5 — usi din ki doosri pending request ab bhi mana (waisa hi)', async () => {
    const r3 = await reg.createRequest(T2, { dateYMD: '2026-11-17', checkOut: '18:30', reason: 'bhool gaya' });
    const rowsBefore = await Notification.countDocuments({});
    let code = null;
    try { await reg.createRequest(T2, { dateYMD: '2026-11-17', checkIn: '09:10', reason: 'dobara' }); } catch (e) { code = `${e.status} ${e.code}`; }
    check('409 DUPLICATE', code === '409 DUPLICATE', String(code));
    check('koi nayi ghanti nahi bani', (await Notification.countDocuments({})) === rowsBefore);
    await reg.withdraw(T2, r3.id);
  });

  // Ek DOOSRA top-rank (owner) role, alag key ke saath — taaki fallback ka "owner tier" aaj ke
  // naam (CEO_PRESIDENT) par hardcoded na ho sake. Wahi galti jo ['CEO','DIRECTOR'] ne ki thi.
  const withSecondOwner = async (fn) => {
    await Role.create({ key: 'OWNER_TWO', label: 'Owner Two', rank: 1, permissions: [] });
    await loadRoles();
    const second = await mk('Second Owner', 'OWNER_TWO');
    try { await fn(); } finally {
      await PushSubscription.deleteMany({ user: second._id });
      await User.deleteOne({ _id: second._id });
      await Role.deleteOne({ key: 'OWNER_TWO' });
      await loadRoles();
    }
  };

  await section('TEST 6 — kisi role ke paas approveRegularization na ho → owner tier ko (rank se, naam se nahi)', async () => {
    await Role.updateMany({}, { $pull: { permissions: 'approveRegularization' } });
    await loadRoles();
    check('(sach me kisi ke paas nahi)', rolesWithPermission('approveRegularization').length === 0);
    await withSecondOwner(async () => {
      sent.length = 0;
      const r4 = await reg.createRequest(O, { dateYMD: '2026-11-16', checkIn: '10:05', reason: 'gate band tha' });
      const got = await who({ type: 'REGULARIZATION', entityId: r4.id });
      check('teeno owner-tier log — doosre owner role wala bhi (deactivated Old Owner nahi)', same(got, [...OWNERS, 'Second Owner']), JSON.stringify(got));
      check('phone push bhi unhi teen ko', same(pushedTo(sent), [...OWNERS, 'Second Owner']), JSON.stringify(pushedTo(sent)));
      await reg.withdraw(O, r4.id);
    });
    await Role.updateMany({ key: { $in: ['CEO_PRESIDENT', 'EXECUTIVE_MANAGER', 'ADMIN_MANAGER_OFFICE'] } }, { $addToSet: { permissions: 'approveRegularization' } });
    await loadRoles();
  });

  await section('TEST 6b — owners ke paas permission NA ho, kisi aur ke paas ho → owners ko ghanti NAHI', async () => {
    // Owner ka niyam: ghanti sirf unhe jo approve kar sakte hain. Owner tier sirf tab, jab
    // KOI role na rakhe — "approvers + owners hamesha" wala design yahan pakda jaata hai.
    await Role.updateOne({ key: 'CEO_PRESIDENT' }, { $pull: { permissions: 'approveRegularization' } });
    await loadRoles();
    sent.length = 0;
    const r = await reg.createRequest(T2, { dateYMD: '2026-11-18', checkIn: '09:50', reason: 'scanner kharab' });
    const got = await who({ type: 'REGULARIZATION', entityId: r.id });
    check('sirf Admin Office + Exec Manager (dono owners nahi)', same(got, ['Admin Office', 'Exec Manager']), JSON.stringify(got));
    await reg.withdraw(T2, r.id);
    await Role.updateOne({ key: 'CEO_PRESIDENT' }, { $addToSet: { permissions: 'approveRegularization' } });
    await loadRoles();
  });

  await section('TEST 6c — JAANI-PEHCHAANI SEEMA: permission sirf maangne wale ke role me ho → kisi ko nahi', async () => {
    // Owner ka manzoor niyam "koi ROLE na rakhe to owners" hai — LOG nahi. Admin Office ka role
    // hi akela approver ho aur wahi maange, to role to hai (fallback nahi chalta) aur khud ko
    // ghanti nahi jaati. Aaj is office me owner role ke paas ye permission hai, isliye ye
    // haalat ban hi nahi sakti. Ye check us seema ko PAKKA likhta hai — badalni ho to owner se
    // poochh kar, jaan-boojh kar.
    await Role.updateMany({ key: { $in: ['CEO_PRESIDENT', 'EXECUTIVE_MANAGER'] } }, { $pull: { permissions: 'approveRegularization' } });
    await loadRoles();
    const r = await reg.createRequest(A, { dateYMD: '2026-11-18', checkIn: '09:45', reason: 'bhool gaya' });
    const got = await who({ type: 'REGULARIZATION', entityId: r.id });
    check('kisi ko nahi (aaj ki seema, jaan-boojh kar)', same(got, []), JSON.stringify(got));
    await reg.withdraw(A, r.id);
    await Role.updateMany({ key: { $in: ['CEO_PRESIDENT', 'EXECUTIVE_MANAGER'] } }, { $addToSet: { permissions: 'approveRegularization' } });
    await loadRoles();
  });

  await section('TEST 7 — koi junior role galti se "DIRECTOR" key ka ban jaaye → use ghanti NAHI', async () => {
    // Role ka label "Director" rakho to key DIRECTOR banti hai (roles.controller slugify).
    // Purana code LEADERSHIP = ['CEO','DIRECTOR'] padhta tha — to ghanti us junior ko jaati,
    // asli approvers ko nahi. Ab naam se koi lena-dena nahi.
    await Role.create({ key: 'DIRECTOR', label: 'Director', rank: 50, permissions: ['markAttendance', 'applyLeave'] });
    await loadRoles();
    await mk('Junior Director', 'DIRECTOR');
    const r5 = await reg.createRequest(T2, { dateYMD: '2026-11-16', checkIn: '09:20', reason: 'net nahi tha' });
    const got = await who({ type: 'REGULARIZATION', entityId: r5.id });
    check('"Junior Director" ko kuch nahi', !got.includes('Junior Director'), JSON.stringify(got));
    check('ghanti asli approvers ko', same(got, APPROVERS), JSON.stringify(got));
    await reg.withdraw(T2, r5.id);
    await User.deleteOne({ role: 'DIRECTOR' });
    await Role.deleteOne({ key: 'DIRECTOR' });
    await loadRoles();
  });

  await section('TEST 8 — leave: aam din (approveLeave walon ko) — pehle jaisa hi', async () => {
    sent.length = 0;
    const lr = await applyLeave(T1, { type: 'CASUAL', startYMD: '2026-12-01', endYMD: '2026-12-01', reason: 'ghar ka kaam' });
    const got = await who({ type: 'LEAVE_REQUEST', entityId: lr.id });
    check('BP Three + dono owners (jinke paas approveLeave hai)', same(got, ['BP Three', ...OWNERS]), JSON.stringify(got));
    check('phone push bhi unhi ko', same(pushedTo(sent), ['BP Three', ...OWNERS]), JSON.stringify(pushedTo(sent)));
  });

  await section('TEST 9 — leave: kisi role ke paas approveLeave na ho → owner tier ko (pehle kisi ko nahi)', async () => {
    await Role.updateMany({}, { $pull: { permissions: 'approveLeave' } });
    await loadRoles();
    check('(sach me kisi ke paas nahi)', rolesWithPermission('approveLeave').length === 0);
    await withSecondOwner(async () => {
      sent.length = 0;
      const lr = await applyLeave(T2, { type: 'CASUAL', startYMD: '2026-12-02', endYMD: '2026-12-02', reason: 'shaadi' });
      const got = await who({ type: 'LEAVE_REQUEST', entityId: lr.id });
      // PURANA code: backup ['CEO','DIRECTOR'] → is office me kisi ko nahi → [].
      check('teeno owner-tier log (bug me kisi ko nahi)', same(got, [...OWNERS, 'Second Owner']), JSON.stringify(got));
      check('phone push bhi unhi teen ko', same(pushedTo(sent), [...OWNERS, 'Second Owner']), JSON.stringify(pushedTo(sent)));
    });
    await Role.updateMany({ key: { $in: ['CEO_PRESIDENT', 'BP_TEAM'] } }, { $addToSet: { permissions: 'approveLeave' } });
    await loadRoles();
  });

  await section('TEST 10 — WFH request sirf owners ko — BP Three (approveLeave) ko NAHI (pehle jaisa)', async () => {
    // WFH ka faisla sirf owner tier karta hai; ye raasta is badlav me chhuna nahi tha.
    let day = ymdInTz(new Date()); // aaj ya aage ka kaam ka din (Sunday office ka off hai)
    if (dayOfWeekInTz(companyDayFromYMD(day)) === 0) day = ymdInTz(new Date(companyDayFromYMD(day).getTime() + 30 * 3600e3));
    check('(fixture: BP_TEAM ke paas approveLeave hai)', rolesWithPermission('approveLeave').includes('BP_TEAM'));
    sent.length = 0;
    const wr = await applyLeave(O, { type: 'WFH', startYMD: day, endYMD: day, reason: 'ghar par plumber' });
    const got = await who({ type: 'LEAVE_REQUEST', entityId: wr.id });
    check(`WFH (${day}) → sirf dono owners`, same(got, OWNERS), JSON.stringify(got));
    check('phone push bhi sirf dono owners ko', same(pushedTo(sent), OWNERS), JSON.stringify(pushedTo(sent)));
  });

  await section('TEST 11 — leadership record DELETE kare → us correction ki ghanti sabki bell se hate', async () => {
    const r = await reg.createRequest(T1, { dateYMD: '2026-11-18', checkOut: '18:40', reason: 'bhool gaya' });
    check('(pehle chaaron approvers ki bell me)', (await Notification.countDocuments({ type: 'REGULARIZATION', entityId: r.id })) === 4);
    await reg.remove(r.id);
    check('delete ke baad kisi ki bell me nahi', (await Notification.countDocuments({ type: 'REGULARIZATION', entityId: r.id })) === 0);
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
