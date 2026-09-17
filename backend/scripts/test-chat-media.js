/**
 * ISOLATED-DB test (throwaway DB — asli data ko chhuta NAHI).
 *
 * Chat Phase 3 (file/photo/PDF/video). Asli S3 ke bina bhi wo sab jaancha ja sakta hai
 * jo SURAKSHA ka hissa hai — aur wahi sabse zaroori hai:
 *
 *   • UPLOAD KI PARCHI: ek chat ke liye bani parchi doosri chat me na chale, ek bande ki
 *     parchi doosra istemal na kar sake, chhedi hui ya purani parchi na chale. Iske bina
 *     koi bhi kisi doosri chat ki file ka pata likh kar use apne message me chipka deta.
 *   • FILE PAR BHI ISOLATION: teesra banda na file ka link le sake, na thumbnail ka.
 *   • S3 KA KEY KABHI BAHAR NA JAYE: client ko sirf naam/size milta hai, pata nahi —
 *     warna wo ek sthayi pata ban jaata jispar koi jaanch hi nahi.
 *
 * Run (backend folder se):  node scripts/test-chat-media.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_test_chatmedia'; // throwaway DB
// Nakli bucket: media "chaalu" maana jaayega, par asli S3 call koi nahi hogi — har wo
// jaanch jo S3 se PEHLE hoti hai, yahin jaanchi ja sakti hai.
process.env.CHAT_MEDIA_BUCKET = 'test-bucket-not-real';

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Message } from '../src/models/Message.js';
import { Conversation } from '../src/models/Conversation.js';
import { loadRoles } from '../src/lib/roles.js';
import { sealBytes } from '../src/lib/secretBox.js';
import { readUploadToken, MAX_FILE_BYTES, DAILY_QUOTA_BYTES } from '../src/lib/chatMedia.js';
import * as chat from '../src/services/chat.service.js';
import { Setting } from '../src/models/Setting.js';

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

/** Seedha DB me ek file-wala message daal do (S3 ko chhue bina). */
async function putFileMessage(conv, sender, { name = 'plan.pdf', mime = 'application/pdf', size = 1024, thumb = false } = {}) {
  const stamped = await Conversation.findOneAndUpdate(
    { _id: conv.id },
    { $inc: { lastSeq: 1 }, $set: { lastMessageAt: new Date(), lastMessageBy: sender._id, lastMessageKind: 'FILE' } },
    { new: true },
  );
  const full = await Conversation.findById(conv.id).lean();
  return Message.create({
    conversation: conv.id,
    seq: stamped.lastSeq,
    sender: sender._id,
    participants: full.participants,
    kind: 'FILE',
    body: null,
    file: {
      key: `chat/2026/09/${'a'.repeat(32)}.b`,
      thumbKey: thumb ? `chat/2026/09/${'b'.repeat(32)}.t` : '',
      name: sealBytes(name),
      mime,
      size,
    },
  });
}

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
  const chhaya = await mk('Chhaya', 'chhaya@t.co');

  const ab = await chat.openDirect(asha, brij._id);
  const ac = await chat.openDirect(asha, chhaya._id);

  console.log('PART 1 — upload ki parchi (sabse bada khatra)');
  // Parchi sirf signUpload se banti hai, jo S3 ko chhuti hai — isliye yahan wahi parchi
  // banate hain jo readUploadToken samajhta hai, uske public bartav ko jaanchne ke liye.
  const { signUpload } = await import('../src/lib/chatMedia.js');
  let parchi = null;
  try {
    const out = await signUpload({ conversationId: ab.id, userId: asha._id });
    parchi = out.uploadToken;
  } catch {
    // S3 tak pahunche bina parchi nahi milti — tab manually banwa lo usi raaste se
  }
  if (!parchi) {
    // signUpload S3 par nirbhar hai; parchi ka signing hissa alag se jaanch lete hain
    const crypto = await import('node:crypto');
    const secret = crypto.createHash('sha256')
      .update(`chat-upload|${process.env.APP_ENC_KEY || process.env.JWT_SECRET || 'dev-insecure-secret-change-me'}`)
      .digest();
    const mkTok = (obj) => {
      const p = Buffer.from(JSON.stringify(obj)).toString('base64url');
      const sig = Buffer.from(crypto.createHmac('sha256', secret).update(p).digest()).toString('base64url');
      return `${p}.${sig}`;
    };
    parchi = mkTok({ k: 'chat/2026/09/xyz.b', t: '', c: String(ab.id), u: String(asha._id), exp: Date.now() + 60000 });
    global.__mkTok = mkTok;
  }

  const good = readUploadToken(parchi, { conversationId: ab.id, userId: asha._id });
  check('apni parchi apni chat me chalti hai', !!good && !!good.key, good ? good.key : 'null');
  check('DOOSRI CHAT me wahi parchi nahi chalti', readUploadToken(parchi, { conversationId: ac.id, userId: asha._id }) === null);
  check('DOOSRA BANDA wahi parchi istemal nahi kar sakta', readUploadToken(parchi, { conversationId: ab.id, userId: brij._id }) === null);
  check('chhedi hui parchi nahi chalti', readUploadToken(`${parchi}x`, { conversationId: ab.id, userId: asha._id }) === null);
  check('khaali/bakwaas parchi nahi chalti',
    readUploadToken('', { conversationId: ab.id, userId: asha._id }) === null
    && readUploadToken('a.b', { conversationId: ab.id, userId: asha._id }) === null);
  if (global.__mkTok) {
    const stale = global.__mkTok({ k: 'chat/x.b', t: '', c: String(ab.id), u: String(asha._id), exp: Date.now() - 1000 });
    check('purani parchi nahi chalti', readUploadToken(stale, { conversationId: ab.id, userId: asha._id }) === null);
  }

  console.log('\nPART 2 — bina parchi ke file-message nahi banta');
  await throwsWith('nakli parchi par message nahi banta', 'BAD_UPLOAD', () =>
    chat.sendMessage(asha, ab.id, { upload: { uploadToken: 'nakli', name: 'x.pdf', mime: 'application/pdf' } }));
  await throwsWith('doosri chat ki parchi yahan nahi chalti', 'BAD_UPLOAD', () =>
    chat.sendMessage(asha, ac.id, { upload: { uploadToken: parchi, name: 'x.pdf', mime: 'application/pdf' } }));
  await throwsWith('doosre bande ki parchi nahi chalti', 'BAD_UPLOAD', () =>
    chat.sendMessage(brij, ab.id, { upload: { uploadToken: parchi, name: 'x.pdf', mime: 'application/pdf' } }));

  console.log('\nPART 3 — file wala message: kya dikhta hai, kya nahi');
  const fm = await putFileMessage(ab, asha, { name: 'Sector-45-layout.pdf', mime: 'application/pdf', size: 2048, thumb: true });
  const view = await chat.listMessages(brij, ab.id);
  const shown = view.messages.find((m) => m.kind === 'FILE');
  check('file wala message dikhta hai', !!shown);
  check('asli naam dikhta hai', shown.file.name === 'Sector-45-layout.pdf', shown.file?.name);
  check('type aur size dikhte hain', shown.file.mime === 'application/pdf' && shown.file.size === 2048);
  check('thumbnail hone ka pata chalta hai', shown.file.hasThumb === true);
  const dump = JSON.stringify(shown);
  check('S3 ka KEY kabhi bahar nahi jaata', !dump.includes('chat/2026/'), dump.slice(0, 120));
  check('thumbKey bhi bahar nahi jaata', !dump.includes('.t"') && !dump.includes('bbbb'));

  console.log('\nPART 4 — database me filename plaintext me nahi hai');
  const raw = await mongoose.connection.db.collection('messages').findOne({ _id: fm._id });
  check('filename DB me encrypted hai', !JSON.stringify(raw).includes('Sector-45-layout'));
  check('mime plaintext hai (render ke liye zaroori)', raw.file.mime === 'application/pdf');

  console.log('\nPART 5 — chat list me file ka parichay (naam kabhi nahi)');
  await chat.sendMessage(asha, ab.id, { text: '', upload: undefined, replyToSeq: undefined }).catch(() => {});
  const list = await chat.listConversations(brij);
  const row = list.find((c) => c.id === ab.id);
  check('list file wali chat ko FILE batati hai', row.lastMessageKind === 'FILE');

  console.log('\nPART 6 — file par ISOLATION');
  await throwsWith('teesra banda file ka link nahi le sakta', 'NOT_FOUND', () => chat.mediaLink(chhaya, fm._id));
  await throwsWith('teesra banda thumbnail bhi nahi le sakta', 'NOT_FOUND', () => chat.mediaLink(chhaya, fm._id, { thumb: true }));
  await throwsWith('bakwaas id par 404', 'NOT_FOUND', () => chat.mediaLink(asha, 'not-an-id'));
  await throwsWith('anjaan id par 404', 'NOT_FOUND', () => chat.mediaLink(asha, new mongoose.Types.ObjectId()));
  const textMsg = await chat.sendMessage(asha, ab.id, { text: 'sirf text' });
  await throwsWith('text message ka koi media link nahi', 'NOT_FOUND', () => chat.mediaLink(asha, textMsg.id));

  console.log('\nPART 7 — apne liye hataya hua file bhi nahi khulta');
  await chat.deleteForMe(brij, fm._id);
  await throwsWith('hataane ke baad Brij ko link nahi milta', 'NOT_FOUND', () => chat.mediaLink(brij, fm._id));
  // Asha ne nahi hataya, to uski JAANCH paar honi chahiye. Yahan asli AWS credentials
  // nahi hain, isliye link banane wala aakhri kadam fail ho sakta hai — hum wahi dekh
  // rahe hain ki use 404 (yaani "teri file hi nahi") NAHI milta.
  const ashaErr = await chat.mediaLink(asha, fm._id).then(() => null).catch((e) => e);
  check('Asha ki jaanch paar hoti hai (usne nahi hataya)',
    ashaErr === null || (ashaErr.status !== 404 && ashaErr.code !== 'NOT_FOUND'),
    ashaErr ? `${ashaErr.code || ashaErr.name}` : 'link mil gaya');
  // Delete-for-everyone: bhejne wala hataye to DONO ke liye file band — Asha ki bhi.
  await chat.deleteForEveryone(asha, fm._id);
  await throwsWith('sabke liye hataane par Asha ko bhi link nahi', 'NOT_FOUND', () => chat.mediaLink(asha, fm._id));
  const rawFile = await Message.findOne({ _id: fm._id }).select('file deletedAt').lean();
  check('S3 ki file DB me abhi bhi darj hai (records ke liye, hataai nahi)', !!rawFile.file?.key && !!rawFile.deletedAt);

  console.log('\nPART 8 — din ka quota');
  await Message.create({
    conversation: ab.id,
    seq: 9999,
    sender: asha._id,
    participants: (await Conversation.findById(ab.id).lean()).participants,
    kind: 'FILE',
    file: { key: 'chat/2026/09/big.b', name: sealBytes('big.zip'), mime: 'application/zip', size: DAILY_QUOTA_BYTES },
  });
  await throwsWith('quota poora hone par naya upload mana', 'QUOTA', () => chat.requestUpload(asha, ab.id));
  const brijOk = await chat.requestUpload(brij, ab.id).then(() => 'signed').catch((e) => e.code);
  check('doosre bande ka quota alag hai', brijOk !== 'QUOTA', `${brijOk}`);

  console.log('\nPART 9 — media band ho to saaf mana, crash nahi');
  const bucket = process.env.CHAT_MEDIA_BUCKET;
  delete process.env.CHAT_MEDIA_BUCKET;
  const fresh = await import(`../src/lib/chatMedia.js?nocache=${Date.now()}`);
  check('bucket na ho to media band dikhta hai', fresh.chatMediaConfigured() === false);
  process.env.CHAT_MEDIA_BUCKET = bucket;

  console.log('');
  console.log('PART 9b — Settings ka switch: owner file bhejna band kar de');
  // Default: ON. Bucket set hai (upar), to sab chalna chahiye.
  check('default me switch ON hai', (await chat.mediaConfig()).enabled === true);

  await Setting.updateOne({ key: 'global' }, { $set: { chatFilesEnabled: false } }, { upsert: true });
  Setting.invalidateCache();
  check('OFF karte hi button ka jawab false', (await chat.mediaConfig()).enabled === false);
  await throwsWith('OFF par upload ki parchi nahi milti', 'MEDIA_OFF', () => chat.requestUpload(brij, ab.id));
  // Purane tab ke paas parchi bachi ho to bhi message nahi banta — taala service me hai,
  // button me nahi.
  await throwsWith('OFF par file wala message bhi nahi banta', 'MEDIA_OFF', () =>
    chat.sendMessage(brij, ab.id, { upload: { uploadToken: 'x.y' } }));
  const textOk = await chat.sendMessage(brij, ab.id, { text: 'switch band hai par text chalta hai' })
    .then(() => 'sent').catch((e) => e.code);
  check('OFF par bhi TEXT message chalta hai', textOk === 'sent', `${textOk}`);
  // Pehle se bheji file ab bhi khulti hai (spinner-forever nahi) — link ka raasta 404 nahi deta.
  const oldFile = await Message.findOne({ conversation: ab.id, kind: 'FILE' }).lean();
  const linkOk = await chat.mediaLink(brij, oldFile._id).then(() => 'ok').catch((e) => e.code);
  check('OFF par purani file ka link ab bhi banta hai (404 nahi)', linkOk !== 'NOT_FOUND' && linkOk !== 'MEDIA_OFF', `${linkOk}`);

  await Setting.updateOne({ key: 'global' }, { $set: { chatFilesEnabled: true } });
  Setting.invalidateCache();
  check('wapas ON karte hi button wapas', (await chat.mediaConfig()).enabled === true);

  console.log('\nPART 10 — seemaayein');
  check('file ki seema 25 MB hai', MAX_FILE_BYTES === 25 * 1024 * 1024);
  check('din ka quota 200 MB hai', DAILY_QUOTA_BYTES === 200 * 1024 * 1024);

  console.log(`\n${failures ? `❌ ${failures} check FAIL` : '✅ sab checks pass'}\n`);
  await mongoose.connection.dropDatabase();
  await disconnectDB();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await disconnectDB(); } catch { /* */ } process.exit(1); });
