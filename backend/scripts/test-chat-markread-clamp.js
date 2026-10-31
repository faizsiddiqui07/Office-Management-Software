/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * "Padh liya" ka nishaan chat ke aakhri number (lastSeq) se upar kabhi nahi (24 Oct 2026).
 * Client bhejte waqt galti se temporary bubble ka seq (9007199254740991) bhej deta tha, aur
 * server use save kar leta tha. Tab:
 *   - us bande ka unread kabhi saaf nahi hota
 *   - saamne wale ko har aane wale message par jhoothe neele tick
 * Yahan jaancha jaata hai: server number kaatta hai, pehle se kharab nishaan chat kholte hi
 * theek hota hai, sahi nishaan kabhi peeche nahi jaata, aur scripts/repair-chat-watermarks.js
 * bachi hui kharab rows sahi jagah theek karta hai.
 *
 * Run (backend folder se):  node scripts/test-chat-markread-clamp.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_chat_clamp'; // throwaway DB

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import { loadRoles } from '../src/lib/roles.js';
import { handleSocketEvent } from '../src/lib/chatSocket.js';
import { issueTicket } from '../src/lib/chatTicket.js';
import * as rt from '../src/services/chatRealtime.service.js';
import * as chat from '../src/services/chat.service.js';

const MAX = Number.MAX_SAFE_INTEGER;
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}

const member = async (convId, user) => {
  const c = await Conversation.findById(convId).lean();
  return { ...c.members.find((m) => String(m.user) === String(user._id)), lastSeq: c.lastSeq };
};
// Kisi member ka nishaan seedha DB me bigaado — wahi haalat jo purane bug ne banayi.
const corrupt = (convId, user, set) => Conversation.updateOne(
  { _id: convId },
  { $set: Object.fromEntries(Object.entries(set).map(([k, v]) => [`members.$[m].${k}`, v])) },
  { arrayFilters: [{ 'm.user': user._id }] },
);
// Asha ki screen par uske apne message ka tick kaisa dikhega (conversation-view.jsx Ticks jaisa).
const tickOf = async (viewer, convId, seq) => {
  const { conversation: c } = await chat.listMessages(viewer, convId);
  if (seq <= c.peerReadUpToSeq) return 'blue';
  if (seq <= c.peerDeliveredUpToSeq) return 'grey-double';
  return 'single';
};
const repair = (...args) => execFileSync(process.execPath, ['scripts/repair-chat-watermarks.js', '--db', process.env.MONGODB_DB, ...args], {
  cwd: BACKEND, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});

async function main() {
  await connectDB();
  if (!/test/i.test(process.env.MONGODB_DB)) throw new Error('refusing: DB name has no "test"');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 Isolated DB: ${process.env.MONGODB_DB}\n`);

  await Role.create([{ key: 'TEAM', label: 'Team', rank: 40, permissions: [], isSystem: true }]);
  await loadRoles();
  const mk = (n, e) => User.create({ name: n, email: e, passwordHash: 'x', role: 'TEAM', employeeId: `R-${e.split('@')[0]}`, isActive: true });
  const asha = await mk('Asha', 'asha@t.co');
  const brij = await mk('Brij', 'brij@t.co');
  const chhaya = await mk('Chhaya', 'chhaya@t.co');
  const dev = await mk('Dev', 'dev@t.co');

  // Nakli live connection, taaki `chat:read` event ka number bhi jaancha ja sake.
  const sent = [];
  rt.setRealtimeSender(async (connectionId, body) => { sent.push({ connectionId, event: JSON.parse(body) }); });
  await handleSocketEvent({ requestContext: { routeKey: '$connect', connectionId: 'asha-tab' }, queryStringParameters: { ticket: issueTicket(asha._id) } });
  const readEvents = () => sent.filter((s) => s.event.type === 'chat:read').map((s) => s.event.upToSeq);

  const { id: c1 } = await chat.openDirect(asha, brij._id);
  for (const t of ['ek', 'do', 'teen']) await chat.sendMessage(asha, c1, { text: t });

  console.log('PART 1 — temporary bubble ka number (asli bug ka raasta)');
  sent.length = 0;
  let r = await chat.markRead(brij, c1, MAX);
  let b = await member(c1, brij);
  check('MAX maanga → 3 par kata (readUpToSeq)', b.readUpToSeq === 3, `readUpToSeq=${b.readUpToSeq}`);
  check('deliveredUpToSeq bhi 3', b.deliveredUpToSeq === 3, `deliveredUpToSeq=${b.deliveredUpToSeq}`);
  check('unread 0', b.unread === 0);
  check('jawab me 3', r.readUpToSeq === 3);
  check('Asha ko gaya event bhi 3, MAX nahi', readEvents().length === 1 && readEvents()[0] === 3, JSON.stringify(readEvents()));

  await chat.sendMessage(asha, c1, { text: 'chaar' });
  check('naya message #4: Asha ko neela NAHI (purane bug me neela hota)', (await tickOf(asha, c1, 4)) === 'single', await tickOf(asha, c1, 4));
  check('Brij ka unread 1', (await member(c1, brij)).unread === 1);
  r = await chat.markRead(brij, c1, 4);
  b = await member(c1, brij);
  check('Brij ne #4 padha → unread 0 (purane bug me 1 par atakta)', b.unread === 0 && b.readUpToSeq === 4, `unread=${b.unread} read=${b.readUpToSeq}`);
  check('ab #4 Asha ko neela', (await tickOf(asha, c1, 4)) === 'blue');

  console.log('\nPART 2 — ajeeb number');
  const { id: c2 } = await chat.openDirect(asha, chhaya._id);
  for (const t of ['a', 'b', 'c', 'd', 'e']) await chat.sendMessage(asha, c2, { text: t });
  await chat.markRead(chhaya, c2, 2.7);
  check('2.7 → 2 (aadha number nahi)', (await member(c2, chhaya)).readUpToSeq === 2);
  await chat.markRead(chhaya, c2, -5);
  check('-5 → kuch nahi badla', (await member(c2, chhaya)).readUpToSeq === 2);
  await chat.markRead(chhaya, c2, 0);
  check('0 → peeche nahi gaya', (await member(c2, chhaya)).readUpToSeq === 2);
  await chat.markRead(chhaya, c2, 1e308);
  check('1e308 → 5 par kata', (await member(c2, chhaya)).readUpToSeq === 5);
  await chat.sendMessage(asha, c2, { text: 'f' });
  await chat.markRead(chhaya, c2, 'abc');
  check("'abc' → poori chat (6), purane jaisa", (await member(c2, chhaya)).readUpToSeq === 6);
  await chat.sendMessage(asha, c2, { text: 'g' });
  await chat.markRead(chhaya, c2);
  check('number hi nahi → poori chat (7), purane jaisa', (await member(c2, chhaya)).readUpToSeq === 7);
  sent.length = 0;
  const before = await member(c2, chhaya);
  r = await chat.markRead(chhaya, c2, 7);
  const after = await member(c2, chhaya);
  check('sahi nishaan par wahi number dobara → koi write nahi', String(before.lastReadAt) === String(after.lastReadAt));
  check('…aur koi event nahi', readEvents().length === 0);

  console.log('\nPART 3 — pehle se kharab nishaan: chat kholte hi theek');
  await chat.sendMessage(asha, c1, { text: 'paanch' }); // #5
  await corrupt(c1, brij, { readUpToSeq: MAX, deliveredUpToSeq: MAX, unread: 0 });
  for (const t of ['chhe', 'saat']) await chat.sendMessage(asha, c1, { text: t }); // #6, #7 — Brij unread 2
  check('bug ki haalat: Asha ko #7 par jhootha neela', (await tickOf(asha, c1, 7)) === 'blue');
  check('bug ki haalat: Brij unread 2', (await member(c1, brij)).unread === 2);
  sent.length = 0;
  r = await chat.markRead(brij, c1, 7);
  b = await member(c1, brij);
  check('kholte hi: read 7, delivered 7, unread 0', b.readUpToSeq === 7 && b.deliveredUpToSeq === 7 && b.unread === 0, JSON.stringify({ r: b.readUpToSeq, d: b.deliveredUpToSeq, u: b.unread }));
  check('event 7 (Asha ki screen bhi theek ho)', readEvents()[0] === 7, JSON.stringify(readEvents()));
  await chat.sendMessage(asha, c1, { text: 'aath' }); // #8
  check('theek hone ke baad #8 Asha ko neela NAHI', (await tickOf(asha, c1, 8)) === 'single');

  await corrupt(c1, brij, { readUpToSeq: MAX, deliveredUpToSeq: MAX, unread: 1 });
  await chat.markRead(brij, c1, 6); // purani screen: chhota number
  b = await member(c1, brij);
  check('kharab + purani screen ka chhota number (6) → 6 par theek', b.readUpToSeq === 6 && b.deliveredUpToSeq === 6, JSON.stringify({ r: b.readUpToSeq, d: b.deliveredUpToSeq }));

  console.log('\nPART 4 — sirf "pahuncha" kharab: sahi "padha" peeche NAHI jaata');
  await chat.markRead(brij, c1, 8);
  await corrupt(c1, brij, { deliveredUpToSeq: MAX });
  await chat.markRead(brij, c1, 5);
  b = await member(c1, brij);
  check('read 8 hi raha (5 par nahi gira)', b.readUpToSeq === 8, `read=${b.readUpToSeq}`);
  check('delivered 8 par theek', b.deliveredUpToSeq === 8, `delivered=${b.deliveredUpToSeq}`);

  console.log('\nPART 4b - do "padh liya" ek saath: nishaan peeche NAHI girta');
  {
    // Saamne wale ki screen har aane wale message par ek markRead bhejti hai, aur wo
    // calls saath-saath chalti hain. markRead pehle haalat PADHTA hai, phir LIKHTA hai.
    // Jab tak likhna `$set` tha, jo pehle padhta wo baad me likh sakta tha aur nishaan
    // 12 se 5 par gir jaata - ek sahi neela tick grey ho jaata. Ab `$max` hai.
    //
    // Apni jodi, taaki PART 5 ke scenario se na takraye (openDirect purani chat hi
    // laut aata hai, to jodi dobara istemaal karne par wahan ke number bigad jaate hain).
    const race = await mk('Race Tester', 'race@t.co');
    const { id: cr } = await chat.openDirect(asha, race._id);
    const N = 12;
    for (let i = 0; i < N; i += 1) await chat.sendMessage(asha, cr, { text: `m${i + 1}` });

    let dips = 0;
    for (let round = 0; round < 25; round += 1) {
      await Conversation.updateOne(
        { _id: cr },
        { $set: { 'members.$[m].readUpToSeq': 0, 'members.$[m].deliveredUpToSeq': 0, 'members.$[m].unread': 1 } },
        { arrayFilters: [{ 'm.user': race._id }] },
      );
      // Saare number ek saath, ulte-seedhe kram me - sabse bada beech me. Sab ek hi pal
      // par 0 padhte hain, phir apna-apna likhte hain; `$set` par aakhri likhne wala
      // jeet jaata tha, `$max` par sabse bada.
      const order = [3, 9, N, 2, 11, 5, N - 1, 7, 4, 10, 6, 8];
      await Promise.all(order.map((v) => chat.markRead(race, cr, v)));
      if ((await member(cr, race)).readUpToSeq < N) dips += 1;
    }
    check(`25 baar ${12} ek-saath call: nishaan kabhi peeche nahi gira`, dips === 0, `${dips} baar gira`);
    const fin = await member(cr, race);
    check('aur delivered bhi saath chala', fin.deliveredUpToSeq >= fin.readUpToSeq, JSON.stringify({ r: fin.readUpToSeq, d: fin.deliveredUpToSeq }));

    // Kharab nishaan theek karna phir bhi NEECHE la sakta hai - wahi ek raasta `$set` hai.
    await corrupt(cr, race, { readUpToSeq: MAX, deliveredUpToSeq: MAX, unread: 2 });
    await chat.markRead(race, cr, 7);
    check('kharab MAX phir bhi theek hota hai (neeche aata hai)', (await member(cr, race)).readUpToSeq === 7, String((await member(cr, race)).readUpToSeq));

    // Do theek karne wale ek saath: pehla jeete, doosra chupchap kuch na kare.
    await corrupt(cr, race, { readUpToSeq: MAX, deliveredUpToSeq: MAX, unread: 2 });
    await Promise.all([chat.markRead(race, cr, 9), chat.markRead(race, cr, 11)]);
    const both = await member(cr, race);
    check('do theek karne wale saath me: sahi daayre me, MAX nahi bacha', both.readUpToSeq <= N && both.readUpToSeq >= 9, String(both.readUpToSeq));
  }

  console.log('\nPART 5 — repair script');
  const esha = await mk('Esha', 'esha@t.co');
  const farhan = await mk('Farhan', 'farhan@t.co');
  const gita = await mk('Gita', 'gita@t.co');
  const say = async (who, conv, ...texts) => { for (const t of texts) await chat.sendMessage(who, conv, { text: t }); };

  // A — c3 (Asha ↔ Dev): Asha #1, Dev padhta hai, Dev #2 (yahin kharab), Asha #3, #4.
  const { id: c3 } = await chat.openDirect(asha, dev._id);
  await say(asha, c3, '1');
  await chat.markRead(dev, c3, 1);
  await say(dev, c3, '2');
  await corrupt(c3, dev, { readUpToSeq: MAX, deliveredUpToSeq: MAX, unread: 0 });
  await say(asha, c3, '3', '4');
  // B — c2 (Asha ↔ Chhaya): Chhaya kharab, unread 0, apna koi message nahi → lastReadAt se.
  await corrupt(c2, chhaya, { readUpToSeq: MAX, deliveredUpToSeq: MAX, unread: 0 });
  // C — REVIEW #7: beech-beech me jawab. Esha #1 #2, Farhan padhta hai, Farhan #3 (yahin
  // kharab), phir Esha #4, Farhan #5, Esha #6, Farhan #7, Esha #8, Farhan #9, Esha #10.
  const { id: cI } = await chat.openDirect(esha, farhan._id);
  await say(esha, cI, '1', '2');
  await chat.markRead(farhan, cI, 2);
  await say(farhan, cI, '3');
  await corrupt(cI, farhan, { readUpToSeq: MAX, deliveredUpToSeq: MAX, unread: 0 });
  for (let i = 4; i <= 10; i += 1) await say(i % 2 ? farhan : esha, cI, String(i));
  // D — REVIEW #9: ek message ki row bani hi nahi (lastSeq/unread badhe, Message.create fail).
  const { id: cP } = await chat.openDirect(esha, gita._id);
  await say(esha, cP, '1');
  await chat.markRead(gita, cP, 1);
  await say(gita, cP, '2');
  await corrupt(cP, gita, { readUpToSeq: MAX, deliveredUpToSeq: MAX, unread: 0 });
  await say(esha, cP, '3');
  await Conversation.updateOne({ _id: cP }, { $inc: { lastSeq: 1, 'members.$[o].unread': 1 } }, { arrayFilters: [{ 'o.user': gita._id }] }); // #4 bina row
  await say(esha, cP, '5');
  // E — koi saboot nahi: Gita ne Farhan ki chat kabhi kholi nahi, apna message bhi nahi.
  const { id: cN } = await chat.openDirect(farhan, gita._id);
  await say(farhan, cN, '1', '2', '3');
  await corrupt(cN, gita, { readUpToSeq: MAX, deliveredUpToSeq: MAX, unread: 2 });
  // F — c4 (Brij ↔ Chhaya): unread 5 par saamne wale ka sirf 1 message; Chhaya ka apna #2.
  const { id: c4 } = await chat.openDirect(brij, chhaya._id);
  await say(brij, c4, 'x');
  await say(chhaya, c4, 'y');
  await corrupt(c4, chhaya, { readUpToSeq: MAX, deliveredUpToSeq: MAX, unread: 5 });
  // G — REVIEW 2 #0: apna aakhri message FILE (upload ke baad number mila). Hina ↔ Ravi:
  // Hina #1, Ravi padhta hai, Ravi text #2 (yahin kharab), Hina #3 #4, phir Ravi ki FILE #5.
  const hina = await mk('Hina', 'hina@t.co');
  const ravi = await mk('Ravi', 'ravi@t.co');
  const { id: cF } = await chat.openDirect(hina, ravi._id);
  await say(hina, cF, '1');
  await chat.markRead(ravi, cF, 1);
  await say(ravi, cF, '2');
  await corrupt(cF, ravi, { readUpToSeq: MAX, deliveredUpToSeq: MAX, unread: 0 });
  await say(hina, cF, '3', '4');
  const stampedF = await Conversation.findOneAndUpdate({ _id: cF }, { $inc: { lastSeq: 1, 'members.$[o].unread': 1 } }, { new: true, arrayFilters: [{ 'o.user': hina._id }] });
  await Message.create({ conversation: cF, seq: stampedF.lastSeq, sender: ravi._id, participants: [hina._id, ravi._id], kind: 'FILE', body: null, file: { key: 'k', name: null, mime: 'video/mp4', size: 1 } });
  // H — REVIEW 2 #1: "delete for me". Hari ↔ Sona: Sona #1, Hari padhta hai, Hari #2 (kharab),
  // Sona #3 — Hari ne dekh kar khud ke liye hata diya.
  const hari = await mk('Hari', 'hari@t.co');
  const sona = await mk('Sona', 'sona@t.co');
  const { id: cD } = await chat.openDirect(sona, hari._id);
  await say(sona, cD, '1');
  await chat.markRead(hari, cD, 1);
  await say(hari, cD, '2');
  await corrupt(cD, hari, { readUpToSeq: MAX, deliveredUpToSeq: MAX, unread: 0 });
  const s3 = await chat.sendMessage(sona, cD, { text: '3' });
  await chat.deleteForMe(hari, s3.id);
  // I — REVIEW 2 #2: aakhri message abhi "ja raha" (number mila, row abhi nahi). Tara ↔ Uma.
  const tara = await mk('Tara', 'tara@t.co');
  const uma = await mk('Uma', 'uma@t.co');
  const { id: cS } = await chat.openDirect(uma, tara._id);
  await say(uma, cS, '1');
  await chat.markRead(tara, cS, 1);
  await say(tara, cS, '2');
  await corrupt(cS, tara, { readUpToSeq: MAX, deliveredUpToSeq: MAX, unread: 0 });
  const stampedS = await Conversation.findOneAndUpdate({ _id: cS }, { $inc: { lastSeq: 1, 'members.$[o].unread': 1 }, $set: { lastMessageAt: new Date() } }, { new: true, arrayFilters: [{ 'o.user': tara._id }] });
  const healthy = await member(c1, brij);

  const snap = async () => JSON.stringify(await Conversation.find({}).sort({ _id: 1 }).select('members lastSeq').lean());
  const s0 = await snap();
  const dry = repair();
  check('dry run: DB bilkul nahi badla', (await snap()) === s0);
  check('dry run: 9 kharab dikhe', /me se 9 member/.test(dry), dry.split('\n').find((l) => /member/.test(l)));
  check('dry run: bina saboot wale par chetavni', /na apna message mila na lastReadAt/.test(dry));

  const out = repair('--apply');
  check('apply: "8 theek, 1 chhode" (I abhi ja raha)', /8 theek, 1 chhode/.test(out), out.split('\n').filter((l) => /theek|chhode|RUKO/.test(l)).join(' | '));
  check('apply: I ke liye "abhi ja raha" bataya', /abhi ja raha tha/.test(out));
  check('apply: 1 bacha, dobara chalane ko kaha', /abhi bhi 1 kharab bache/.test(out));

  let d = await member(c3, dev);
  check('A Dev: read 2 (apna #2), delivered 2, unread 2', d.readUpToSeq === 2 && d.deliveredUpToSeq === 2 && d.unread === 2, JSON.stringify({ r: d.readUpToSeq, d: d.deliveredUpToSeq, u: d.unread }));
  check('A Asha ko #3 aur #4 par neela NAHI, #1 neela', (await tickOf(asha, c3, 3)) === 'single' && (await tickOf(asha, c3, 4)) === 'single' && (await tickOf(asha, c3, 1)) === 'blue');
  const devView = await chat.listMessages(dev, c3);
  check('A Dev ko "2 unread" line #3 se pehle (myReadUpToSeq 2, myUnread 2)', devView.conversation.myReadUpToSeq === 2 && devView.conversation.myUnread === 2);
  await chat.markRead(dev, c3, 4);
  d = await member(c3, dev);
  check('A Dev ne chat kholi → unread 0 (badge saaf), read 4', d.unread === 0 && d.readUpToSeq === 4);

  const ch = await member(c2, chhaya);
  check('B Chhaya: read = lastSeq (aakhri baar padhne tak sab), unread 0', ch.readUpToSeq === ch.lastSeq && ch.deliveredUpToSeq === ch.lastSeq && ch.unread === 0, JSON.stringify({ r: ch.readUpToSeq, last: ch.lastSeq, u: ch.unread }));

  const f = await member(cI, farhan);
  check('C Farhan: read 9 (apna aakhri jawab), unread 1 (sirf #10)', f.readUpToSeq === 9 && f.deliveredUpToSeq === 9 && f.unread === 1, JSON.stringify({ r: f.readUpToSeq, d: f.deliveredUpToSeq, u: f.unread }));
  check('C Esha: #4 #6 #8 neele (Farhan ne jawab diya), #10 akela', (await tickOf(esha, cI, 4)) === 'blue' && (await tickOf(esha, cI, 6)) === 'blue' && (await tickOf(esha, cI, 8)) === 'blue' && (await tickOf(esha, cI, 10)) === 'single');
  const fv = await chat.listMessages(farhan, cI);
  check('C Farhan ko "1 unread" line sirf #10 ke upar', fv.conversation.myReadUpToSeq === 9 && fv.conversation.myUnread === 1);

  const gp = await member(cP, gita);
  check('D Gita: read 2 (apna #2), unread 2 (sirf sach me bani rows #3 #5)', gp.readUpToSeq === 2 && gp.unread === 2, JSON.stringify({ r: gp.readUpToSeq, u: gp.unread, last: gp.lastSeq }));
  check('D Esha ka #1 neela hi (pehle ka padha hua peeche nahi gaya)', (await tickOf(esha, cP, 1)) === 'blue');

  const gn = await member(cN, gita);
  check('E bina saboot: Farhan ke aakhri 2 bina padhe → read 1, unread 2', gn.readUpToSeq === 1 && gn.unread === 2, JSON.stringify({ r: gn.readUpToSeq, u: gn.unread }));

  const g4 = await member(c4, chhaya);
  check('F Chhaya: read 2 (apna #2), unread 0 (gadbad ginti 5 hatai)', g4.readUpToSeq === 2 && g4.unread === 0, JSON.stringify({ r: g4.readUpToSeq, u: g4.unread }));
  const rv = await member(cF, ravi);
  check('G Ravi: FILE #5 saboot NAHI → read 2 (apna text), unread 2 (#3 #4)', rv.readUpToSeq === 2 && rv.unread === 2, JSON.stringify({ r: rv.readUpToSeq, u: rv.unread }));
  check('G Hina ko #3 #4 par neela NAHI', (await tickOf(hina, cF, 3)) === 'single' && (await tickOf(hina, cF, 4)) === 'single');

  const hr = await member(cD, hari);
  check('H Hari: khud hataya #3 = dekha → read 3, unread 0', hr.readUpToSeq === 3 && hr.unread === 0, JSON.stringify({ r: hr.readUpToSeq, u: hr.unread }));

  let tr = await member(cS, tara);
  check('I Tara: abhi chhoda (MAX hi), kuch nahi bigda', tr.readUpToSeq === MAX && tr.unread === 1, JSON.stringify({ r: tr.readUpToSeq, u: tr.unread }));
  await Message.create({ conversation: cS, seq: stampedS.lastSeq, sender: uma._id, participants: [uma._id, tara._id], kind: 'TEXT', body: null });
  const out2 = repair('--apply');
  tr = await member(cS, tara);
  check('I row ban gayi, dobara chalaya → read 2 (apna), unread 1 (Uma ka #3)', tr.readUpToSeq === 2 && tr.unread === 1 && /1 theek, 0 chhode/.test(out2), JSON.stringify({ r: tr.readUpToSeq, u: tr.unread }));

  check('sahi row (Brij c1) nahi chhui', JSON.stringify(await member(c1, brij)) === JSON.stringify(healthy));

  // --db ki galtiyan: kabhi chupchap prod par nahi. (Child ko test DB ka env diya hai — dotenv
  // use nahi badalta — taaki guard toota bhi ho to sirf test DB chhua jaaye, prod nahi.)
  const bad = (...a) => { try { execFileSync(process.execPath, ['scripts/repair-chat-watermarks.js', ...a], { cwd: BACKEND, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MONGODB_DB: process.env.MONGODB_DB } }); return 'chal gaya'; } catch (e) { return `ruka: ${(e.stderr || '').trim()}`; } };
  check('--apply bina --db → ruka', /--apply ke saath DB ka naam/.test(bad('--apply')));
  check('--db bina naam → ruka', /--db ke baad DB ka naam/.test(bad('--db', '--apply')));
  check('--db=naam bhi chalta hai', /Database: office_test_chat_clamp/.test(execFileSync(process.execPath, ['scripts/repair-chat-watermarks.js', `--db=${process.env.MONGODB_DB}`], { cwd: BACKEND, encoding: 'utf8' })));

  const again = repair('--apply');
  check('dobara chalaya: kuch karne ko nahi', /ek bhi kharab nishaan nahi/.test(again));
}

main()
  .then(async () => {
    console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PAAS'}`);
    if (mongoose.connection.name === 'office_test_chat_clamp') await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(failures ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(e);
    if (mongoose.connection.name === 'office_test_chat_clamp') await mongoose.connection.dropDatabase();
    await disconnectDB();
    process.exit(1);
  });
