/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * Chat Phase 4 (notification). Kisi ke phone par kuch bheje bina jaancha jaata hai:
 * chatPush.service ka sender badla ja sakta hai (setPushSender), to yahan ek nakli sender
 * lagakar dekha jaata hai ki KYA bheja gaya — kitni baar, kis text ke saath, aur kab
 * bheja hi nahi gaya.
 *
 * Jo cheezein maayne rakhti hain:
 *   • DAS MESSAGE PAR DAS GHANTIYAN NAHI: pehla poora + buzz, uske baad wahi notification
 *     chupchap badalta hai ("3 naye message").
 *   • KHULI CHAT PAR KUCH NAHI: jo chat saamne khuli hai uska notification nahi jaata.
 *   • MUTE: band ki hui chat ka notification nahi jaata.
 *   • TEXT KABHI NAHI: notification me message ka matn kabhi nahi hota.
 *   • PADHNE PAR GINTI SAAF: agle message par phir poora notification aur buzz.
 *
 * Run (backend folder se):  node scripts/test-chat-push.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_chatpush'; // throwaway DB

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Notification } from '../src/models/Notification.js';
import { ChatPushState } from '../src/models/ChatPushState.js';
import { loadRoles } from '../src/lib/roles.js';
import { setPushSender } from '../src/services/chatPush.service.js';
import { handleSocketEvent } from '../src/lib/chatSocket.js';
import { issueTicket } from '../src/lib/chatTicket.js';
import * as chat from '../src/services/chat.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}

// Nakli sender: asli push kabhi nahi jaata, bas likh lete hain ki kya bheja gaya.
const pushes = [];
setPushSender(async (userId, payload) => { pushes.push({ userId: String(userId), ...payload }); });

const wsEvent = (routeKey, connectionId, extra = {}) => ({ requestContext: { routeKey, connectionId }, ...extra });
const settle = () => new Promise((r) => setTimeout(r, 120)); // push fire-and-forget hai

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([{ key: 'TEAM', label: 'Team', rank: 40, permissions: [], isSystem: true }]);
  await loadRoles();
  const mk = (n, e) => User.create({ name: n, email: e, passwordHash: 'x', role: 'TEAM', employeeId: `R-${e[0]}`, isActive: true });
  const asha = await mk('Asha Verma', 'asha@t.co');
  const brij = await mk('Brij Mehta', 'brij@t.co');
  const conv = await chat.openDirect(asha, brij._id);

  console.log('PART 1 — pehla message: poora notification aur buzz');
  await chat.sendMessage(asha, conv.id, { text: 'Sector 45 ka layout bhej diya hai' });
  await settle();
  check('ek hi push gaya', pushes.length === 1, `${pushes.length}`);
  check('Brij ko gaya (khud ko nahi)', pushes[0].userId === String(brij._id));
  check('title me bhejne wale ka naam', pushes[0].title === 'Asha Verma', pushes[0].title);
  check('body me MESSAGE KA TEXT NAHI hai', !pushes[0].body.includes('Sector 45'), pushes[0].body);
  check('body saada hai', pushes[0].body === 'Sent you a message', pushes[0].body);
  check('pehle par buzz hota hai (renotify)', pushes[0].renotify === true);
  check('tag per-chat hai', pushes[0].type === `chat:${conv.id}`, pushes[0].type);
  check('link seedha usi chat par kholta hai', pushes[0].link === `/chat?c=${conv.id}`);

  console.log('\nPART 2 — ghanti (bell) me chat ki entry NAHI banti');
  check('Notification collection khaali hai', (await Notification.countDocuments()) === 0,
    `${await Notification.countDocuments()} rows`);

  console.log('\nPART 3 — das message par das ghantiyan nahi');
  pushes.length = 0;
  for (let i = 2; i <= 10; i += 1) await chat.sendMessage(asha, conv.id, { text: `message ${i}` });
  await settle();
  check('9 aur message gaye par push bhi 9 hi bane', pushes.length === 9, `${pushes.length}`);
  check('inme se KISI par buzz nahi hua', pushes.every((p) => p.renotify === false));
  check('sabka tag ek hi hai (ek doosre ko badal dete hain)', new Set(pushes.map((p) => p.type)).size === 1);
  check('text "N naye message" ban gaya', /new messages/.test(pushes[pushes.length - 1].body), pushes[pushes.length - 1].body);
  check('ginti badhti gayi', pushes[pushes.length - 1].body === '10 new messages', pushes[pushes.length - 1].body);
  check('kisi bhi push me message ka matn nahi', pushes.every((p) => !/message \d/.test(p.body) || /new messages/.test(p.body)));

  console.log('\nPART 4 — padh lene par ginti saaf');
  await chat.markRead(brij, conv.id);
  await settle();
  check('ginti wali row hat gayi', (await ChatPushState.countDocuments({ key: `${brij._id}:${conv.id}` })) === 0);
  pushes.length = 0;
  await chat.sendMessage(asha, conv.id, { text: 'naya silsila' });
  await settle();
  check('agla message phir se pehla maana gaya', pushes[0].body === 'Sent you a message', pushes[0].body);
  check('aur uspar phir buzz hua', pushes[0].renotify === true);

  console.log('\nPART 5 — jo chat saamne khuli hai uska notification nahi');
  await handleSocketEvent(wsEvent('$connect', 'brij-tab', { queryStringParameters: { ticket: issueTicket(brij._id) } }));
  await handleSocketEvent(wsEvent('$default', 'brij-tab', { body: JSON.stringify({ type: 'open', conversationId: conv.id }) }));
  pushes.length = 0;
  await chat.sendMessage(asha, conv.id, { text: 'wo saamne dekh raha hai' });
  await settle();
  check('koi push nahi gaya', pushes.length === 0, `${pushes.length} gaye`);
  // Chat band karte hi phir se jaana chahiye
  await handleSocketEvent(wsEvent('$default', 'brij-tab', { body: JSON.stringify({ type: 'open', conversationId: null }) }));
  await chat.sendMessage(asha, conv.id, { text: 'ab band kar di' });
  await settle();
  check('chat band karte hi push wapas jaane laga', pushes.length === 1, `${pushes.length}`);

  console.log('\nPART 6 — mute');
  await chat.setMuted(brij, conv.id, new Date(Date.now() + 3600e3));
  pushes.length = 0;
  await chat.sendMessage(asha, conv.id, { text: 'mute ke dauran' });
  await settle();
  check('mute par koi push nahi', pushes.length === 0, `${pushes.length}`);
  await chat.setMuted(brij, conv.id, null);
  await chat.sendMessage(asha, conv.id, { text: 'unmute ke baad' });
  await settle();
  check('unmute karte hi push wapas', pushes.length === 1, `${pushes.length}`);

  console.log('\nPART 7 — file wale message ka notification');
  pushes.length = 0;
  await chat.markRead(brij, conv.id);
  await settle();
  // File wala notification seedha service se — asli S3 ke bina.
  const { notifyNewMessage } = await import('../src/services/chatPush.service.js');
  await notifyNewMessage({ toUser: brij._id, fromName: 'Asha Verma', conversationId: conv.id, fileLabel: 'Sent a PDF' });
  await settle();
  check('file ka type bataya jaata hai', pushes[0]?.body === 'Sent a PDF', pushes[0]?.body);
  check('par FILE KA NAAM kabhi nahi', !/\.pdf/i.test(pushes[0]?.body || ''));

  console.log('\nPART 8 — dono taraf alag-alag ginti');
  await ChatPushState.deleteMany({});
  pushes.length = 0;
  await chat.sendMessage(asha, conv.id, { text: 'Asha se' });
  await chat.sendMessage(brij, conv.id, { text: 'Brij se' });
  await settle();
  const toBrij = pushes.filter((p) => p.userId === String(brij._id));
  const toAsha = pushes.filter((p) => p.userId === String(asha._id));
  check('dono ko apna-apna pehla push mila', toBrij.length === 1 && toAsha.length === 1);
  check('dono par buzz hua', toBrij[0].renotify === true && toAsha[0].renotify === true);
  check('kisi ko apna hi message nahi laut kar aaya', toBrij[0].title === 'Asha Verma' && toAsha[0].title === 'Brij Mehta');

  console.log(`\n${failures ? `❌ ${failures} check FAIL` : '✅ sab checks pass'}\n`);
  await mongoose.connection.dropDatabase();
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await disconnectDB(); } catch { /* */ } process.exit(1); });
