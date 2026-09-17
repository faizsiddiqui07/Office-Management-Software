/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * Chat Phase 2 (live connection). AWS ke bina jaancha jaata hai: bhejne wala "sender"
 * bahar se aata hai, to yahan ek nakli sender lagakar poori fan-out aur safai wali logic
 * chalayi jaati hai.
 *
 * Jo cheezein sabse zyada maayne rakhti hain:
 *   • BHARPAI (catch-up): connection tootne ke beech aaye message `after=<seq>` se poore
 *     wapas aane chahiye — ek bhi chhoota to chat app ka sabse bura bug ban jaata hai.
 *   • MARE HUE CONNECTION: 410 aane par row turant hatni chahiye, warna har message par
 *     bekaar (aur billable) call jaati rahegi.
 *   • PARCHI (ticket): galat/purani parchi par connection na khule.
 *   • KHULI CHAT: jo chat saamne khuli hai uska push na jaye.
 *
 * Run (backend folder se):  node scripts/test-chat-realtime.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_chatrt'; // throwaway DB

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { ChatConnection } from '../src/models/ChatConnection.js';
import { loadRoles } from '../src/lib/roles.js';
import { issueTicket, readTicket } from '../src/lib/chatTicket.js';
import { isSocketEvent, handleSocketEvent } from '../src/lib/chatSocket.js';
import * as rt from '../src/services/chatRealtime.service.js';
import * as chat from '../src/services/chat.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}

// Nakli sender: kya-kya bheja gaya yaad rakhta hai, aur jin connections ko "mara hua"
// bataya gaya hai un par wahi GoneException phenkta hai jo AWS phenkta hai.
function fakeSender({ dead = new Set() } = {}) {
  const sent = [];
  const fn = async (connectionId, body) => {
    if (dead.has(connectionId)) {
      const e = new Error('Gone');
      e.name = 'GoneException';
      throw e;
    }
    sent.push({ connectionId, event: JSON.parse(body) });
  };
  fn.sent = sent;
  return fn;
}

const wsEvent = (routeKey, connectionId, extra = {}) => ({
  requestContext: { routeKey, connectionId },
  ...extra,
});

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([{ key: 'TEAM', label: 'Team', rank: 40, permissions: [], isSystem: true }]);
  await loadRoles();
  const mk = (n, e) => User.create({ name: n, email: e, passwordHash: 'x', role: 'TEAM', employeeId: `R-${e[0]}`, isActive: true });
  const asha = await mk('Asha', 'asha@t.co');
  const brij = await mk('Brij', 'brij@t.co');

  console.log('PART 1 — parchi (ticket)');
  const t = issueTicket(asha._id);
  check('apni parchi khud padhi jaati hai', String(readTicket(t)) === String(asha._id));
  check('chhedi hui parchi radd', readTicket(`${t}x`) === null);
  check('bakwaas parchi radd', readTicket('v1.abc.def') === null && readTicket('') === null && readTicket(null) === null);
  check('parchi dobara bhi chalti hai (reconnect race par logout nahi)', String(readTicket(t)) === String(asha._id));
  const expired = (() => {
    const real = Date.now;
    Date.now = () => real() - 120_000; // 2 minute purani
    const old = issueTicket(asha._id);
    Date.now = real;
    return old;
  })();
  check('purani parchi (60s se zyada) radd', readTicket(expired) === null);

  console.log('\nPART 2 — $connect / $disconnect');
  check('WebSocket event pehchana jaata hai', isSocketEvent(wsEvent('$connect', 'c1')) === true);
  check('HTTP v2 request socket event NAHI hai', isSocketEvent({ requestContext: { connectionId: 'x', http: { method: 'GET' } } }) === false);
  check('HTTP v1 request socket event NAHI hai', isSocketEvent({ requestContext: { connectionId: 'x', httpMethod: 'GET' } }) === false);
  check('cron event socket event NAHI hai', isSocketEvent({ cron: true }) === false);

  const bad = await handleSocketEvent(wsEvent('$connect', 'c-bad', { queryStringParameters: { ticket: 'nakli' } }));
  check('galat parchi par 401', bad.statusCode === 401);
  check('galat parchi se koi row nahi bani', (await ChatConnection.countDocuments()) === 0);

  await handleSocketEvent(wsEvent('$connect', 'asha-tab1', { queryStringParameters: { ticket: issueTicket(asha._id) } }));
  await handleSocketEvent(wsEvent('$connect', 'asha-tab2', { queryStringParameters: { ticket: issueTicket(asha._id) } }));
  await handleSocketEvent(wsEvent('$connect', 'brij-tab1', { queryStringParameters: { ticket: issueTicket(brij._id) } }));
  check('teen connection bane (Asha ke do tab + Brij)', (await ChatConnection.countDocuments()) === 3);
  const row = await ChatConnection.findOne({ connectionId: 'asha-tab1' }).lean();
  check('connection par TTL ki tareekh lagi hai', row.expiresAt instanceof Date && row.expiresAt > new Date());

  await handleSocketEvent(wsEvent('$disconnect', 'asha-tab2'));
  check('$disconnect par row hat gayi', (await ChatConnection.countDocuments()) === 2);

  console.log('\nPART 3 — online kaun hai, aur kaun si chat khuli hai');
  const online = await rt.onlineUserIds([asha._id, brij._id]);
  check('dono online dikhte hain', online.has(String(asha._id)) && online.has(String(brij._id)));
  const conv = await chat.openDirect(asha, brij._id);
  await handleSocketEvent(wsEvent('$default', 'brij-tab1', { body: JSON.stringify({ type: 'open', conversationId: conv.id }) }));
  check('Brij ke tab me ye chat khuli hai', (await rt.hasConversationOpen(brij._id, conv.id)) === true);
  check('kisi aur chat ke liye nahi', (await rt.hasConversationOpen(asha._id, conv.id)) === false);
  await handleSocketEvent(wsEvent('$default', 'brij-tab1', { body: JSON.stringify({ type: 'ping' }) }));
  check('ping par khuli chat saaf ho jaati hai', (await rt.hasConversationOpen(brij._id, conv.id)) === false);

  console.log('\nPART 4 — message live jaata hai (dono taraf)');
  const sender = fakeSender();
  rt.setRealtimeSender(sender);
  check('realtime ab chaalu hai', rt.realtimeEnabled() === true);
  await chat.sendMessage(asha, conv.id, { text: 'Live test' });
  const msgEvents = sender.sent.filter((s) => s.event.type === 'chat:message');
  check('event dono taraf gaya (Asha ka tab + Brij ka tab)', msgEvents.length === 2, `${msgEvents.length} sent`);
  check('event me message ka text hai', msgEvents[0].event.message.text === 'Live test');
  check('event me sender ki pehchan hai', String(msgEvents[0].event.message.sender) === String(asha._id));
  check('event me conversation id hai', msgEvents[0].event.conversationId === conv.id);

  sender.sent.length = 0;
  await chat.markRead(brij, conv.id);
  const readEvents = sender.sent.filter((s) => s.event.type === 'chat:read');
  check('padhne par sirf saamne wale ko event gaya', readEvents.length === 1 && readEvents[0].connectionId === 'asha-tab1');
  check('read event me kitna padha wo hai', readEvents[0].event.upToSeq === 1);

  // Delete for everyone — dono taraf 'chat:deleted' jaaye, taaki bubble turant tombstone bane.
  sender.sent.length = 0;
  const toWipe = await chat.sendMessage(asha, conv.id, { text: 'galti se' });
  sender.sent.length = 0;
  await chat.deleteForEveryone(asha, toWipe.id);
  const delEvents = sender.sent.filter((s) => s.event.type === 'chat:deleted');
  check('delete-for-everyone par event dono taraf gaya', delEvents.length === 2, `${delEvents.length} sent`);
  check('event me message id + seq hai', delEvents[0].event.messageId === toWipe.id && delEvents[0].event.seq === toWipe.seq);
  check('event me matn NAHI hai', !JSON.stringify(delEvents[0].event).includes('galti se'));

  console.log('\nPART 5 — mara hua connection apne aap hat jaata hai');
  await handleSocketEvent(wsEvent('$connect', 'asha-dead', { queryStringParameters: { ticket: issueTicket(asha._id) } }));
  check('abhi Asha ke do connection hain', (await ChatConnection.countDocuments({ user: asha._id })) === 2);
  const s2 = fakeSender({ dead: new Set(['asha-dead']) });
  rt.setRealtimeSender(s2);
  const res = await rt.publishToUsers([asha._id], { type: 'test' });
  check('zinda connection par gaya', res.sent === 1, `sent=${res.sent}`);
  check('mara hua connection hata diya gaya', res.pruned === 1, `pruned=${res.pruned}`);
  check('DB me bhi wo row nahi bachi', (await ChatConnection.countDocuments({ connectionId: 'asha-dead' })) === 0);

  console.log('\nPART 6 — BHARPAI (connection tootne ke beech ke message)');
  // Brij "offline" ho jaata hai; Asha 5 message bhejti hai; Brij wapas judta hai aur
  // sirf `after` se chhoote hue message maangta hai.
  await handleSocketEvent(wsEvent('$disconnect', 'brij-tab1'));
  const before = await chat.listMessages(brij, conv.id);
  const lastSeenSeq = before.messages[before.messages.length - 1].seq;
  for (let i = 1; i <= 5; i += 1) await chat.sendMessage(asha, conv.id, { text: `offline ke dauran ${i}` });
  const missed = await chat.listMessages(brij, conv.id, { after: lastSeenSeq });
  check('paanchon chhoote hue message wapas mile', missed.messages.length === 5, `${missed.messages.length}`);
  check('sab lastSeenSeq ke BAAD ke hain', missed.messages.every((m) => m.seq > lastSeenSeq));
  check('purana→naya kram me hain', missed.messages[0].seq < missed.messages[4].seq);
  check('pehla chhoota hua message sahi hai', missed.messages[0].text === 'offline ke dauran 1');
  check('aakhri bhi sahi hai', missed.messages[4].text === 'offline ke dauran 5');
  const nothingNew = await chat.listMessages(brij, conv.id, { after: missed.messages[4].seq });
  check('sab utha lene ke baad kuch bacha nahi', nothingNew.messages.length === 0);

  console.log('\nPART 7 — bharpai me bhi ISOLATION nahi tootti');
  const chhaya = await mk('Chhaya', 'chhaya@t.co');
  try {
    await chat.listMessages(chhaya, conv.id, { after: 0 });
    check('teesra banda after= se chura nahi sakta', false, 'koi error nahi — LEAK!');
  } catch (e) {
    check('teesra banda after= se bhi kuch nahi churaa sakta', e.status === 404, `status ${e.status}`);
  }

  console.log('\nPART 8 — khuli chat par push nahi jaata');
  // Brij dobara judta hai aur wahi chat khol leta hai.
  await handleSocketEvent(wsEvent('$connect', 'brij-tab2', { queryStringParameters: { ticket: issueTicket(brij._id) } }));
  await handleSocketEvent(wsEvent('$default', 'brij-tab2', { body: JSON.stringify({ type: 'open', conversationId: conv.id }) }));
  check('Brij ke saamne yahi chat khuli hai', (await rt.hasConversationOpen(brij._id, conv.id)) === true);
  // (sendMessage push ko fire-and-forget bhejta hai; yahan sirf ye pakka kar rahe hain ki
  //  "khuli hai ya nahi" wala faisla sahi banta hai — wahi push ka gate hai.)
  await handleSocketEvent(wsEvent('$default', 'brij-tab2', { body: JSON.stringify({ type: 'open', conversationId: null }) }));
  check('chat band karte hi gate wapas khul jaata hai', (await rt.hasConversationOpen(brij._id, conv.id)) === false);

  console.log('\nPART 9 — realtime band ho to kuch toot-ta nahi');
  rt.setRealtimeSender(null);
  check('realtime ab band hai', rt.realtimeEnabled() === false);
  const sentAnyway = await chat.sendMessage(asha, conv.id, { text: 'WebSocket ke bina bhi' });
  check('message phir bhi bheja gaya', sentAnyway.text === 'WebSocket ke bina bhi');
  const after = await chat.listMessages(brij, conv.id);
  check('aur wo database me hai', after.messages.some((m) => m.text === 'WebSocket ke bina bhi'));
  check('publish chupchap 0 lautata hai', (await rt.publishToUsers([asha._id], { type: 'x' })).sent === 0);

  console.log(`\n${failures ? `❌ ${failures} check FAIL` : '✅ sab checks pass'}\n`);
  await mongoose.connection.dropDatabase();
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await disconnectDB(); } catch { /* */ } process.exit(1); });
