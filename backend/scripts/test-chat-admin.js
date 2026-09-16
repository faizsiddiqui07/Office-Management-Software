/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * Chat Phase 5 — admin recovery. Ye chat ka EKMATRA apwaad hai: yahan `participants: me`
 * wala filter jaan-bujh kar nahi lagta. Isliye is test ka kaam sirf "chalta hai ya nahi"
 * dekhna nahi hai — ye dekhna hai ki uske TEENO TAALE hamesha lagte hain:
 *
 *   1. Sirf CEO & President. Director/Manager/Employee — koi nahi.
 *   2. Har baar Activity log me entry.
 *   3. Har baar us employee ko notification.
 *
 * Aur ye ki admin ka dekhna kisi ka unread/tick nahi badalta — wo padhta hai, chat me
 * maujood nahi hota.
 *
 * Run (backend folder se):  node scripts/test-chat-admin.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_chatadmin'; // throwaway DB

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Setting } from '../src/models/Setting.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Notification } from '../src/models/Notification.js';
import { Message } from '../src/models/Message.js';
import { loadRoles } from '../src/lib/roles.js';
import { setPushSender } from '../src/services/chatPush.service.js';
import * as chat from '../src/services/chat.service.js';
import * as adminSvc from '../src/services/chatAdmin.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}
async function throwsWith(name, code, fn) {
  try {
    await fn();
    check(name, false, 'koi error nahi aaya!');
  } catch (e) {
    check(name, e.code === code || e.status === code, `code=${e.code} status=${e.status}`);
  }
}

setPushSender(async () => {}); // asli push kabhi nahi
const settle = () => new Promise((r) => setTimeout(r, 120));

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO & President', rank: 0, permissions: ['viewEveryone'], isSystem: true },
    { key: 'DIRECTOR', label: 'Director', rank: 2, permissions: ['viewEveryone'], isSystem: true },
    { key: 'MANAGER', label: 'Manager', rank: 5, permissions: ['viewEveryone'], isSystem: true },
    { key: 'EMPLOYEE', label: 'Employee', rank: 6, permissions: [], isSystem: true },
  ]);
  await loadRoles();
  await Setting.create({ key: 'global', companyName: 'T' });
  Setting.invalidateCache();

  const mk = (n, e, role) => User.create({ name: n, email: e, passwordHash: 'x', role, employeeId: `R-${e[0]}`, isActive: true });
  const owner = await mk('Owner Sahab', 'owner@t.co', 'CEO_PRESIDENT');
  const director = await mk('Deepak Director', 'dir@t.co', 'DIRECTOR');
  const manager = await mk('Manoj Manager', 'mgr@t.co', 'MANAGER');
  const asha = await mk('Asha Verma', 'asha@t.co', 'EMPLOYEE');
  const brij = await mk('Brij Mehta', 'brij@t.co', 'EMPLOYEE');

  const conv = await chat.openDirect(asha, brij._id);
  await chat.sendMessage(asha, conv.id, { text: 'Client ko revised quote bhej diya hai' });
  await chat.sendMessage(brij, conv.id, { text: 'Kitne ka kiya?' });
  await chat.sendMessage(asha, conv.id, { text: 'Chaar lakh bees hazaar' });
  await settle();

  console.log('PART 1 — TAALA #1: sirf CEO & President');
  await throwsWith('Director nahi dekh sakta', 403, () => adminSvc.listUserChats(director, asha._id));
  await throwsWith('Manager nahi dekh sakta', 403, () => adminSvc.listUserChats(manager, asha._id));
  await throwsWith('Employee nahi dekh sakta', 403, () => adminSvc.listUserChats(brij, asha._id));
  await throwsWith('Director chat bhi nahi khol sakta', 403, () => adminSvc.readUserChat(director, asha._id, conv.id));
  await throwsWith('Employee chat bhi nahi khol sakta', 403, () => adminSvc.readUserChat(brij, asha._id, conv.id));
  const list = await adminSvc.listUserChats(owner, asha._id);
  check('CEO & President dekh sakte hain', list.chats.length === 1, `${list.chats.length} chats`);
  check('list me kis se baat hui wo hai', list.chats[0].with.name === 'Brij Mehta');
  check('list me sirf ginti hai, koi message nahi', !JSON.stringify(list).includes('Chaar lakh'));

  console.log('\nPART 2 — chat kholna');
  const before = { audit: await AuditLog.countDocuments(), notif: await Notification.countDocuments() };
  const read = await adminSvc.readUserChat(owner, asha._id, conv.id);
  check('teeno message mile', read.messages.length === 3, `${read.messages.length}`);
  check('matn khula hua aata hai', read.messages[2].text === 'Chaar lakh bees hazaar', read.messages[2].text);
  check('kisne bheja wo bhi', read.messages[0].senderName === 'Asha Verma');

  console.log('\nPART 3 — TAALA #2: Activity log');
  const audits = await AuditLog.find({ action: 'chat.read' }).lean();
  check('log me theek ek entry badhi', (await AuditLog.countDocuments()) === before.audit + 1);
  check('entry CEO ke naam se hai', String(audits[0].actor) === String(owner._id));
  check('entry me bataya kiski chat thi', audits[0].meta.targetName === 'Asha Verma', audits[0].meta?.targetName);
  check('LOG ME MESSAGE KA MATN NAHI', !JSON.stringify(audits[0]).includes('Chaar lakh'));

  console.log('\nPART 4 — TAALA #3: employee ko notification');
  const notifs = await Notification.find({ type: 'CHAT_ACCESS' }).lean();
  check('theek ek notification bana', (await Notification.countDocuments()) === before.notif + 1);
  check('ASHA ko gaya (jiski chat thi)', String(notifs[0].user) === String(asha._id));
  check('usme CEO ka naam hai', notifs[0].message.includes('Owner Sahab'), notifs[0].message);
  check('aur kiske saath wali chat thi', notifs[0].message.includes('Brij Mehta'), notifs[0].message);
  check('NOTIFICATION ME BHI MATN NAHI', !JSON.stringify(notifs[0]).includes('Chaar lakh'));

  console.log('\nPART 5 — admin ka dekhna kuch badalta nahi');
  const brijView = await chat.listConversations(brij);
  check('Brij ka unread waisa hi hai', brijView[0].unread === 2, `${brijView[0].unread}`);
  const ashaView = await chat.listMessages(asha, conv.id);
  check('kisi ka tick nahi badla', ashaView.conversation.peerReadUpToSeq === 0);
  check('admin chat me participant nahi bana',
    !(await mongoose.connection.db.collection('conversations').findOne({ participants: owner._id })));

  console.log('\nPART 6 — admin bhi mann-maani nahi kar sakta');
  const other = await chat.openDirect(director, manager._id);
  await chat.sendMessage(director, other.id, { text: 'Director ki apni baat' });
  await throwsWith('galat banda + chat ka jod nahi chalta', 'NOT_FOUND', () =>
    adminSvc.readUserChat(owner, asha._id, other.id));
  await throwsWith('anjaan banda', 'NOT_FOUND', () => adminSvc.listUserChats(owner, new mongoose.Types.ObjectId()));
  await throwsWith('bakwaas id', 'NOT_FOUND', () => adminSvc.readUserChat(owner, asha._id, 'not-an-id'));

  console.log('\nPART 7 — apni chat me dhoondhna');
  const found = await adminSvc.searchMyMessages(asha, 'lakh');
  check('apna message mil gaya', found.results.length === 1, `${found.results.length}`);
  check('nateeje me kis se baat thi wo bhi', found.results[0].peer?.name === 'Brij Mehta');
  check('bahut chhote shabd par search nahi chalti', (await adminSvc.searchMyMessages(asha, 'l')).results.length === 0);
  const outsider = await adminSvc.searchMyMessages(manager, 'lakh');
  check('DOOSRE KI CHAT SEARCH ME NAHI AATI', outsider.results.length === 0, `${outsider.results.length}`);
  await chat.deleteForMe(asha, (await Message.findOne({ seq: 3 }).lean())._id);
  check('apne liye hataya message search me nahi aata', (await adminSvc.searchMyMessages(asha, 'lakh')).results.length === 0);

  console.log('\nPART 8 — retention ka switch (default: hamesha)');
  let res = await chat.pruneOldChats();
  check('default par kuch nahi hataata', res.off === true && res.pruned === 0);
  const total = await Message.countDocuments();
  await Setting.updateOne({ key: 'global' }, { $set: { chatRetentionDays: 365 } });
  Setting.invalidateCache();
  res = await chat.pruneOldChats();
  check('365 din par bhi aaj ke message nahi hatte', res.pruned === 0 && (await Message.countDocuments()) === total);
  // Ek message ko 400 din purana bana do — SEEDHA driver se, kyunki Mongoose `createdAt`
  // ko immutable rakhta hai aur uska update chupchap kuch nahi karta.
  const old = await Message.findOne({ conversation: conv.id, seq: 1 }).lean();
  await mongoose.connection.db.collection('messages')
    .updateOne({ _id: old._id }, { $set: { createdAt: new Date(Date.now() - 400 * 864e5) } });
  res = await chat.pruneOldChats();
  check('400 din purana message hat gaya', res.pruned === 1, `${res.pruned}`);
  await Setting.updateOne({ key: 'global' }, { $set: { chatRetentionDays: 0 } });
  Setting.invalidateCache();

  console.log(`\n${failures ? `❌ ${failures} check FAIL` : '✅ sab checks pass'}\n`);
  await mongoose.connection.dropDatabase();
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await disconnectDB(); } catch { /* */ } process.exit(1); });
