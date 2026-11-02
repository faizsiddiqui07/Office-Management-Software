/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * SIDEBAR ka laal nishaan sirf USE dikhe jiske liye announcement hai.
 *
 * Bug (owner, 2 Nov 2026): kuch hi logon ko announcement karo, par Announcements wale
 * menu par laal dot SABKO dikhta tha — khol kar dekhne par wahan unke liye kuch hota hi
 * nahi tha. Wajah: badges.service `latest(Announcement, {}, 'createdAt')` chalata tha,
 * yaani poore collection ka sabse naya row, bina ye dekhe ki wo kiske liye hai. Feed aur
 * popup pehle se theek the (wo visibilityFilter use karte hain) — sirf dot galat tha.
 *
 * Yahan har tarah ka audience banaya jaata hai aur DONO baatein jaanchi jaati hain:
 * jisko dikhna chahiye usko dot mile, aur jisko nahi uska dot na jale.
 *
 * Run (backend folder se):  node scripts/test-announcement-badge.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_annbadge'; // throwaway DB

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Announcement } from '../src/models/Announcement.js';
import { loadRoles } from '../src/lib/roles.js';
import { getBadges } from '../src/services/badges.service.js';
import { listVisible } from '../src/services/announcement.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}

/** Kya is bande ke Announcements menu par dot jalega? */
const dot = async (u) => !!(await getBadges(u)).announcements;
/** Aur kya use feed me wo announcement sach me dikhti hai? */
const feedHas = async (u, title) => (await listVisible(u)).some((a) => a.title === title);

let P, M, K, X; // Priyanshi (TEAM), Mariya (AB_TEAM), Kalpana (CEO), Koi Aur (TEAM)

async function announce(o) {
  await Announcement.deleteMany({});
  return Announcement.create({
    title: o.title,
    body: o.body || 'matn',
    priority: 'NORMAL',
    createdBy: K._id,
    audienceRoles: o.roles || [],
    audienceUsers: (o.users || []).map((u) => u._id),
    isActive: o.isActive !== false,
    publishAt: o.publishAt ?? null,
    expiresAt: o.expiresAt ?? null,
    announcedAt: new Date(),
  });
}

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO & President', rank: 0, permissions: [], isSystem: true },
    { key: 'TEAM', label: 'Team', rank: 40, permissions: [], isSystem: true },
    { key: 'AB_TEAM', label: 'AB Team', rank: 100, permissions: [], isSystem: true },
  ]);
  await loadRoles();
  await Setting.create({ key: 'global', companyName: 'TestCo', weekendDays: [0] });
  Setting.invalidateCache();
  const mk = (n, e, role) => User.create({ name: n, email: e, passwordHash: 'x', role, employeeId: `R-${e[0]}`, isActive: true });
  P = await mk('Priyanshi', 'p@t.co', 'TEAM');
  M = await mk('Mariya', 'm@t.co', 'AB_TEAM');
  K = await mk('Kalpana', 'k@t.co', 'CEO_PRESIDENT');
  X = await mk('Koi Aur', 'x@t.co', 'TEAM');

  console.log('TEST 1 — ASLI BUG: sirf do logon ko announcement');
  {
    await announce({ title: 'Sirf Priyanshi aur Mariya ke liye', users: [P, M] });
    check('Priyanshi ka dot jala', (await dot(P)) === true);
    check('Mariya ka dot jala', (await dot(M)) === true);
    check('Koi Aur ka dot NAHI jala (yahi bug tha)', (await dot(X)) === false, 'uska dot jal raha hai');
    check('Kalpana ka dot NAHI jala', (await dot(K)) === false, 'uska dot jal raha hai');
    // Dot aur feed kabhi alag jawab na dein — dot wahi kahe jo khol kar milega.
    check('dot aur feed ek hi baat kehte hain (Priyanshi)', (await dot(P)) === (await feedHas(P, 'Sirf Priyanshi aur Mariya ke liye')));
    check('dot aur feed ek hi baat kehte hain (Koi Aur)', (await dot(X)) === (await feedHas(X, 'Sirf Priyanshi aur Mariya ke liye')));
  }

  console.log('\nTEST 2 — sabke liye (koi audience chuna hi nahi)');
  {
    await announce({ title: 'Sabke liye' });
    check('Priyanshi', (await dot(P)) === true);
    check('Mariya', (await dot(M)) === true);
    check('Kalpana', (await dot(K)) === true);
    check('Koi Aur', (await dot(X)) === true);
  }

  console.log('\nTEST 3 — ek role ke liye');
  {
    await announce({ title: 'Sirf TEAM', roles: ['TEAM'] });
    check('Priyanshi (TEAM) ka dot jala', (await dot(P)) === true);
    check('Koi Aur (TEAM) ka bhi jala', (await dot(X)) === true);
    check('Mariya (AB_TEAM) ka NAHI jala', (await dot(M)) === false);
    check('Kalpana (CEO) ka NAHI jala', (await dot(K)) === false);
  }

  console.log('\nTEST 4 — jo dikhni hi nahi chahiye, uska dot bhi na jale');
  {
    await announce({ title: 'Band ki hui', isActive: false });
    check('isActive false → kisi ka dot nahi', (await dot(P)) === false && (await dot(K)) === false);

    await announce({ title: 'Aage ki tareekh', publishAt: new Date(Date.now() + 24 * 3600 * 1000) });
    check('abhi publish hui hi nahi → kisi ka dot nahi', (await dot(P)) === false && (await dot(K)) === false);

    await announce({ title: 'Purani', expiresAt: new Date(Date.now() - 3600 * 1000) });
    check('expire ho chuki → kisi ka dot nahi', (await dot(P)) === false && (await dot(K)) === false);
  }

  console.log('\nTEST 5 — naya chhup jaaye to purana wala dot bacha rahe');
  {
    // Priyanshi ke liye purani, phir sirf Mariya ke liye nayi — Priyanshi ka dot purani
    // se jalna chahiye, par uska WAQT nayi wali ka nahi hona chahiye.
    await Announcement.deleteMany({});
    const old = await Announcement.create({
      title: 'Priyanshi ke liye', body: 'x', priority: 'NORMAL', createdBy: K._id,
      audienceUsers: [P._id], audienceRoles: [], isActive: true, announcedAt: new Date(),
    });
    await new Promise((r) => { setTimeout(r, 1100); });
    await Announcement.create({
      title: 'Mariya ke liye', body: 'x', priority: 'NORMAL', createdBy: K._id,
      audienceUsers: [M._id], audienceRoles: [], isActive: true, announcedAt: new Date(),
    });
    const b = await getBadges(P);
    check('Priyanshi ka dot jala', !!b.announcements);
    check('…par waqt PURANI wali ka (nayi, jo uski nahi hai, usne waqt aage nahi khiskaya)',
      new Date(b.announcements).getTime() === new Date(old.createdAt).getTime(),
      `${b.announcements} vs ${old.createdAt.toISOString()}`);
    check('Koi Aur ka dot abhi bhi nahi', (await dot(X)) === false);
  }

  console.log('\nTEST 6 — purane rows jinme audienceUsers key hai hi nahi (sabke liye hone chahiye)');
  {
    await Announcement.deleteMany({});
    await Announcement.collection.insertOne({
      title: 'Bahut purani', body: 'x', priority: 'NORMAL', createdBy: K._id,
      audienceRoles: [], isActive: true, createdAt: new Date(), updatedAt: new Date(),
    });
    check('sabka dot jale (key gayab hone par chhup na jaye)',
      (await dot(P)) === true && (await dot(M)) === true && (await dot(X)) === true);
  }
}

main()
  .then(async () => {
    console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PAAS'}`);
    if (mongoose.connection.name === 'office_test_annbadge') await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(failures ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(e);
    if (mongoose.connection.name === 'office_test_annbadge') await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(1);
  });
