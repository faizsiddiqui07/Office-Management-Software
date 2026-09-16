/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * Chat Phase 1: 1:1 conversation, message bhejna, unread, read-watermark (ticks),
 * pagination, reply-quote, delete-for-me, mute — aur sabse zaroori do cheezein:
 *   • ISOLATION: teesra banda kisi aur ki chat na list kar sake, na khol sake, na
 *     message padh sake, na bhej sake. Har case me 404 (403 nahi — 403 bata deta hai
 *     ki cheez maujood hai).
 *   • AT REST ENCRYPTION: database me message ka text plaintext me kahin na mile.
 *
 * Run (backend folder se):  node scripts/test-chat.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_chat'; // throwaway DB

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import { loadRoles } from '../src/lib/roles.js';
import * as chat from '../src/services/chat.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}
async function throws404(name, fn) {
  try {
    await fn();
    check(name, false, 'koi error nahi aaya — LEAK!');
  } catch (e) {
    check(name, e.status === 404, `status ${e.status} "${e.message}"`);
  }
}

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([
    { key: 'CEO_PRESIDENT', label: 'CEO', rank: 0, permissions: ['viewEveryone'], isSystem: true },
    { key: 'TEAM', label: 'Team', rank: 40, permissions: [], isSystem: true },
  ]);
  await loadRoles();
  const mk = (n, e) => User.create({ name: n, email: e, passwordHash: 'x', role: 'TEAM', employeeId: `R-${e[0]}`, isActive: true });
  const asha = await mk('Asha Verma', 'asha@t.co');
  const brij = await mk('Brij Mehta', 'brij@t.co');
  const chhaya = await mk('Chhaya Rao', 'chhaya@t.co'); // ye teesri hai — isko kuch nahi dikhna chahiye
  const gone = await User.create({ name: 'Gone', email: 'g@t.co', passwordHash: 'x', role: 'TEAM', employeeId: 'R-G', isActive: false });

  console.log('PART 1 — chat kholna');
  const c1 = await chat.openDirect(asha, brij._id);
  const c2 = await chat.openDirect(brij, asha._id);
  check('dono taraf se ek hi conversation banti hai', c1.id === c2.id, c1.id);
  check('peer sahi hai', c1.peer.name === 'Brij Mehta' && c2.peer.name === 'Asha Verma');
  check('total conversations = 1 (duplicate nahi)', (await Conversation.countDocuments()) === 1);
  await throws404('deactivated user se chat nahi', async () => chat.openDirect(asha, gone._id));
  try { await chat.openDirect(asha, asha._id); check('apne aap se chat block', false); }
  catch (e) { check('apne aap se chat nahi ho sakti (400)', e.status === 400, `status ${e.status} "${e.message}"`); }

  console.log('\nPART 2 — message bhejna aur unread');
  const m1 = await chat.sendMessage(asha, c1.id, { text: 'Namaste Brij, report bhej di hai' });
  check('seq 1 se shuru', m1.seq === 1);
  check('bhejne wale ko text wapas milta hai', m1.text === 'Namaste Brij, report bhej di hai');
  let convB = (await chat.listConversations(brij))[0];
  check('Brij ko unread 1 dikhta hai', convB.unread === 1, `unread=${convB.unread}`);
  check('Brij ko last message dikhta hai', convB.lastMessage === 'Namaste Brij, report bhej di hai');
  check('Brij ke liye lastMessageMine = false', convB.lastMessageMine === false);
  let convA = (await chat.listConversations(asha))[0];
  check('Asha ka apna unread 0 hai (apne message se nahi badhta)', convA.unread === 0);
  check('Asha ke liye lastMessageMine = true', convA.lastMessageMine === true);
  check('unreadTotal: Brij 1, Asha 0', (await chat.unreadTotal(brij._id)) === 1 && (await chat.unreadTotal(asha._id)) === 0);

  console.log('\nPART 3 — ISOLATION (sabse zaroori)');
  check('Chhaya ki chat list khaali hai', (await chat.listConversations(chhaya)).length === 0);
  check('Chhaya ka unreadTotal 0 hai', (await chat.unreadTotal(chhaya._id)) === 0);
  await throws404('Chhaya doosron ki chat nahi khol sakti', async () => chat.listMessages(chhaya, c1.id));
  await throws404('Chhaya doosron ki chat me bhej nahi sakti', async () => chat.sendMessage(chhaya, c1.id, { text: 'ghuspaith' }));
  await throws404('Chhaya doosron ki chat read-mark nahi kar sakti', async () => chat.markRead(chhaya, c1.id, 1));
  await throws404('Chhaya doosron ki chat mute nahi kar sakti', async () => chat.setMuted(chhaya, c1.id, new Date()));
  const msgDoc = await Message.findOne({ seq: 1 }).lean();
  await throws404('Chhaya doosron ka message delete nahi kar sakti', async () => chat.deleteForMe(chhaya, msgDoc._id));
  await throws404('bakwaas conversation id par 404', async () => chat.listMessages(asha, new mongoose.Types.ObjectId()));
  await throws404('galat shape ki id par bhi 404 (crash nahi)', async () => chat.listMessages(asha, 'not-an-id'));

  console.log('\nPART 4 — DATABASE me kya likha hai (at-rest encryption)');
  const raw = await mongoose.connection.db.collection('messages').findOne({ seq: 1 });
  const rawConv = await mongoose.connection.db.collection('conversations').findOne({});
  const dump = JSON.stringify(raw) + JSON.stringify(rawConv);
  check('message ka text DB me plaintext me NAHI hai', !dump.includes('Namaste Brij'), 'searched raw docs');
  check('body Buffer me hai (base64 string me nahi)', Buffer.isBuffer(raw.body) || raw.body?._bsontype === 'Binary');
  check('chat list ka preview bhi encrypted hai', !dump.includes('report bhej di'));

  console.log('\nPART 5 — ticks (read watermark)');
  let view = await chat.listMessages(asha, c1.id);
  check('abhi Brij ne padha nahi — peerReadUpToSeq 0', view.conversation.peerReadUpToSeq === 0);
  await chat.markRead(brij, c1.id);
  view = await chat.listMessages(asha, c1.id);
  check('Brij ke padhne par Asha ko blue tick (peerReadUpToSeq 1)', view.conversation.peerReadUpToSeq === 1);
  check('Brij ka unread ab 0', (await chat.unreadTotal(brij._id)) === 0);
  const back = await chat.markRead(brij, c1.id, 0);
  check('watermark peeche nahi jaata', back.readUpToSeq === 1, `readUpToSeq=${back.readUpToSeq}`);

  console.log('');
  console.log('PART 5b — "X naye message" wali line ka nishaan');
  // Line kahan lagegi, ye server ke do numbers se tay hota hai: kitne unread hain, aur
  // maine kahan tak padha tha. Dono ek saath sahi hone chahiye.
  const freshConv = await chat.openDirect(asha, chhaya._id);
  await chat.sendMessage(chhaya, freshConv.id, { text: 'pehla' });
  await chat.sendMessage(chhaya, freshConv.id, { text: 'doosra' });
  let fresh = await chat.listMessages(asha, freshConv.id);
  check('kholte waqt unread ki ginti milti hai', fresh.conversation.myUnread === 2, `${fresh.conversation.myUnread}`);
  check('aur "kahan tak padha tha" ka nishaan bhi', fresh.conversation.myReadUpToSeq === 0, `${fresh.conversation.myReadUpToSeq}`);
  await chat.markRead(asha, freshConv.id);
  await chat.sendMessage(chhaya, freshConv.id, { text: 'teesra' });
  fresh = await chat.listMessages(asha, freshConv.id);
  check('padhne ke baad nishaan aage sarak jaata hai', fresh.conversation.myReadUpToSeq === 2, `${fresh.conversation.myReadUpToSeq}`);
  check('aur nayi ginti sirf naye message ki hai', fresh.conversation.myUnread === 1, `${fresh.conversation.myUnread}`);
  const below = fresh.messages.filter((m) => m.seq > fresh.conversation.myReadUpToSeq);
  check('line ke neeche theek wahi message aayenge', below.length === 1 && below[0].text === 'teesra');
  await chat.markRead(asha, freshConv.id);
  fresh = await chat.listMessages(asha, freshConv.id);
  check('sab padh lene par koi line nahi (unread 0)', fresh.conversation.myUnread === 0);

  console.log('\nPART 6 — reply, delete-for-me, mute');
  const r1 = await chat.sendMessage(brij, c1.id, { text: 'Mil gayi, dhanyavaad', replyToSeq: 1 });
  check('reply me quote juda hai', r1.replyTo?.seq === 1 && r1.replyTo.text.includes('Namaste Brij'));
  check('reply karne wale ke liye quote "mine" nahi hai', r1.replyTo.mine === false);
  await chat.deleteForMe(asha, m1.id);
  const ashaView = await chat.listMessages(asha, c1.id);
  const brijView = await chat.listMessages(brij, c1.id);
  check('Asha ko apna delete kiya message nahi dikhta', !ashaView.messages.some((m) => m.seq === 1));
  check('Brij ko wahi message abhi bhi dikhta hai', brijView.messages.some((m) => m.seq === 1));
  await chat.setMuted(asha, c1.id, new Date(Date.now() + 3600e3));
  check('mute lag gaya', (await chat.listConversations(asha))[0].muted === true);
  await chat.setMuted(asha, c1.id, null);
  check('unmute ho gaya', (await chat.listConversations(asha))[0].muted === false);

  console.log('\nPART 7 — pagination (40 message)');
  for (let i = 0; i < 40; i += 1) await chat.sendMessage(asha, c1.id, { text: `message number ${i + 1}` });
  const p1 = await chat.listMessages(brij, c1.id);
  check('pehla page 30 ka hai', p1.messages.length === 30, `${p1.messages.length}`);
  check('aur bhi hai (hasMore)', p1.hasMore === true);
  check('page purane → naye order me hai', p1.messages[0].seq < p1.messages[29].seq);
  const oldest = p1.messages[0].seq;
  const p2 = await chat.listMessages(brij, c1.id, { before: oldest });
  check('doosra page usse purana hai', p2.messages.every((m) => m.seq < oldest));
  const overlap = p2.messages.filter((m) => p1.messages.some((x) => x.seq === m.seq));
  check('do page me koi message repeat nahi', overlap.length === 0);
  const seqs = [...p2.messages, ...p1.messages].map((m) => m.seq);
  check('saare seq unique hain', new Set(seqs).size === seqs.length);
  check('Brij ka unread 40 hai (Asha ke 40 naye message)', (await chat.unreadTotal(brij._id)) === 40, `${await chat.unreadTotal(brij._id)}`);

  console.log('\nPART 8 — galat input');
  try { await chat.sendMessage(asha, c1.id, { text: '   ' }); check('khaali message block', false); }
  catch (e) { check('khaali message block hota hai', e.status === 400, e.code); }
  try { await chat.sendMessage(asha, c1.id, { text: 'x'.repeat(4001) }); check('bahut lamba message block', false); }
  catch (e) { check('4000 se lamba message block hota hai', e.status === 400, e.code); }

  console.log('\nPART 9 — ek saath do log chat kholein (race)');
  await Conversation.deleteMany({});
  await Message.deleteMany({});
  const both = await Promise.allSettled([chat.openDirect(asha, brij._id), chat.openDirect(brij, asha._id)]);
  check('dono call kaamyaab', both.every((r) => r.status === 'fulfilled'), both.map((r) => r.status).join(','));
  check('phir bhi sirf EK conversation bani', (await Conversation.countDocuments()) === 1);
  check('dono ko ek hi id mili', both[0].value?.id === both[1].value?.id);

  console.log(`\n${failures ? `❌ ${failures} check FAIL` : '✅ sab checks pass'}\n`);
  await mongoose.connection.dropDatabase();
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await disconnectDB(); } catch { /* */ } process.exit(1); });
