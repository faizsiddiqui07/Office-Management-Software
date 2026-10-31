/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * NOTIFICATION PHONE TAK JAATI HAI YA NAHI (owner ki shikayat, 27 Oct 2026).
 *
 * Asli bug: `notify()` bell ki row to AWAIT karke banata tha, par phone wala push
 * chhod deta tha —
 *     import('../lib/push.js').then(({ sendPush }) => sendPush(...)).catch(() => {});
 * Local par ye chal jaata hai (process chalta rehta hai), Lambda par nahi: lambda.js me
 * `callbackWaitsForEmptyEventLoop = false` hai (rakhna hi padta hai, warna har request
 * Mongo pool ke khaali hone ka intezaar karti), isliye handler ke laut-te hi container
 * JAM ho jaata hai aur adhoori padi promise wahin ruk jaati hai. Natija: app ke andar
 * ghanti dikhti thi, phone chup rehta tha.
 *
 * Yahan wahi jam nakli banaya jaata hai: notify() ke laut-te hi hum dekh lete hain ki
 * push JA CHUKA hai ya nahi. Purane code par nahi gaya hota — naye par gaya hota hai.
 * Asli web-push nahi bheja jaata; lib/push.js ka bhejne wala hissa nakli hai.
 *
 * Run (backend folder se):  node scripts/test-push-delivery.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_pushdeliver'; // throwaway DB
process.env.VAPID_PUBLIC_KEY = 'test-public';
process.env.VAPID_PRIVATE_KEY = 'test-private';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Setting } from '../src/models/Setting.js';
import { Notification, notify } from '../src/models/Notification.js';
import { PushSubscription } from '../src/models/PushSubscription.js';
import { loadRoles } from '../src/lib/roles.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}

/**
 * web-push ka bhejne wala hissa badal do: na network, na asli VAPID — bas ginti.
 * `delay` se wo dheema push banaya jaata hai jis par timeout ki jaanch hoti hai.
 */
async function stubWebPush({ delay = 0, fail = false } = {}) {
  const webpush = (await import('web-push')).default;
  const sent = [];
  webpush.setVapidDetails = () => {};
  webpush.sendNotification = async (sub, body) => {
    if (delay) await new Promise((r) => { setTimeout(r, delay); });
    if (fail) { const e = new Error('nope'); e.statusCode = 500; throw e; }
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
  };
  return sent;
}

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([{ key: 'TEAM', label: 'Team', rank: 40, permissions: [], isSystem: true }]);
  await loadRoles();
  await Setting.create({ key: 'global', companyName: 'TestCo', weekendDays: [0] });
  Setting.invalidateCache();
  const asha = await User.create({ name: 'Asha', email: 'a@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'R-A', isActive: true });
  const brij = await User.create({ name: 'Brij', email: 'b@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'R-B', isActive: true });

  const sent = await stubWebPush();
  await PushSubscription.create({ user: asha._id, endpoint: 'https://push.test/asha-1', keys: { p256dh: 'k', auth: 'a' } });
  await PushSubscription.create({ user: asha._id, endpoint: 'https://push.test/asha-2', keys: { p256dh: 'k', auth: 'a' } });

  console.log('TEST 1 — notify() ke LAUT-TE hi push ja chuka ho');
  {
    sent.length = 0;
    await notify({ user: asha._id, type: 'INFO', title: 'Leave approved', message: 'Your leave is approved', link: '/leaves' });
    // Yahi asli jaanch hai. Lambda is pal container jam kar deta hai — jo abhi tak nahi
    // gaya, wo kabhi nahi jaayega. PURANA code yahan 0 par khada hota tha.
    check('turant 2 push ja chuke (dono devices par)', sent.length === 2, `${sent.length} gaye`);
    check('…title aur body sahi', sent[0]?.payload?.title === 'Leave approved' && sent[0]?.payload?.body === 'Your leave is approved',
      JSON.stringify(sent[0]?.payload));
    check('…link bhi gaya', sent[0]?.payload?.link === '/leaves');
    check('bell ki row bhi bani', (await Notification.countDocuments({ user: asha._id })) === 1);
  }

  console.log('\nTEST 2 — jiska koi device hi nahi');
  {
    sent.length = 0;
    await notify({ user: brij._id, title: 'Hello', message: 'x' });
    check('koi push nahi gaya', sent.length === 0, String(sent.length));
    check('par bell ki row phir bhi bani', (await Notification.countDocuments({ user: brij._id })) === 1);
  }

  console.log('\nTEST 3 — push fail ho jaaye to bhi notify na toote');
  {
    const failing = await stubWebPush({ fail: true });
    let threw = null;
    try {
      await notify({ user: asha._id, title: 'Fail test', message: 'y' });
    } catch (e) { threw = e.message; }
    check('notify ne error nahi phenka', threw === null, threw || '');
    check('bell ki row phir bhi bani', (await Notification.countDocuments({ user: asha._id, title: 'Fail test' })) === 1);
    check('(fail hone par kuch gina nahi gaya)', failing.length === 0);
  }

  console.log('\nTEST 4 — dheema push poori request ko nahi rokta (3s ki hadd)');
  {
    await stubWebPush({ delay: 10_000 }); // provider atak gaya
    const t0 = Date.now();
    await notify({ user: asha._id, title: 'Slow test', message: 'z' });
    const took = Date.now() - t0;
    check('notify 3.5s ke andar laut aaya (10s wale provider par bhi)', took < 3500, `${took}ms`);
    check('bell ki row phir bhi bani', (await Notification.countDocuments({ user: asha._id, title: 'Slow test' })) === 1);
  }

  console.log('\nTEST 4b — har khabar apni jagah dikhe, pichhli ko chupchap na mitaye');
  {
    // ASLI WAJAH. Service worker `tag` par notification group karta hai, aur ek hi tag
    // par replace karna DEFAULT me khamosh hota hai — na banner, na awaaz. Pehle notify()
    // `tag` bhejta hi nahi tha, to SW `type` utha leta tha, jo sirf shreni hai
    // ('TASK_ASSIGNED'). Natija: teen logon ne kaam diya to phone ek hi baar baja aur
    // baaki do chupchap swap ho gaye.
    const box = await stubWebPush();
    box.length = 0;
    await notify({ user: asha._id, type: 'TASK_ASSIGNED', title: 'Priyanshi se naya kaam', message: 'Survey' });
    await notify({ user: asha._id, type: 'TASK_ASSIGNED', title: 'Khaan se naya kaam', message: 'Drawing' });
    await notify({ user: asha._id, type: 'TASK_ASSIGNED', title: 'Mariya se naya kaam', message: 'Report' });
    const tags = box.map((x) => x.payload.tag);
    check('teeno ke tag ALAG (ek doosre ko nahi mitayenge)', new Set(tags).size === 3, JSON.stringify(tags));
    check('teeno par renotify: true (phone har baar bajega)', box.every((x) => x.payload.renotify === true),
      JSON.stringify(box.map((x) => x.payload.renotify)));
    check('tag ab shreni NAHI hai', tags.every((t) => t !== 'TASK_ASSIGNED'), JSON.stringify(tags));
    check('type phir bhi jaata hai (purane service worker ke liye)', box.every((x) => x.payload.type === 'TASK_ASSIGNED'));
  }

  console.log('\nTEST 4c — EK HI cheez ke baare me dobara khabar → wahi notification badle');
  {
    const box = await stubWebPush();
    box.length = 0;
    const leaveId = new mongoose.Types.ObjectId();
    await notify({ user: asha._id, type: 'LEAVE', title: 'Approve karo', message: 'Asha ki chhutti', entityType: 'LeaveRequest', entityId: leaveId });
    await notify({ user: asha._id, type: 'LEAVE', title: 'Approve karo (yaad dilana)', message: 'Asha ki chhutti', entityType: 'LeaveRequest', entityId: leaveId });
    const tags = box.map((x) => x.payload.tag);
    check('dono ka tag EK (tray me do copy nahi banengi)', tags[0] === tags[1] && tags[0] === `LeaveRequest:${leaveId}`, JSON.stringify(tags));
    check('…par renotify phir bhi true (badalne par bhi phone bajega)', box.every((x) => x.payload.renotify === true));
    const other = new mongoose.Types.ObjectId();
    box.length = 0;
    await notify({ user: asha._id, type: 'LEAVE', title: 'Doosri chhutti', message: 'Brij ki chhutti', entityType: 'LeaveRequest', entityId: other });
    check('doosri cheez ka tag alag', box[0].payload.tag === `LeaveRequest:${other}`, box[0].payload.tag);
  }

  console.log('\nTEST 5 — mara hua device apne aap hat jaaye');
  {
    const webpush = (await import('web-push')).default;
    webpush.sendNotification = async (sub) => {
      if (sub.endpoint.endsWith('asha-2')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
    };
    await notify({ user: asha._id, title: 'Prune test', message: 'p' });
    const left = await PushSubscription.find({ user: asha._id }).select('endpoint').lean();
    check('410 wala device hat gaya, doosra bacha', left.length === 1 && left[0].endpoint.endsWith('asha-1'),
      JSON.stringify(left.map((x) => x.endpoint)));
  }
}

main()
  .then(async () => {
    console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PAAS'}`);
    if (mongoose.connection.name === 'office_test_pushdeliver') await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(failures ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(e);
    if (mongoose.connection.name === 'office_test_pushdeliver') await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(1);
  });
