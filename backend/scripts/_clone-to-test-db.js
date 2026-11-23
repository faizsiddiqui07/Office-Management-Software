/**
 * Asli (prod) data ki ek COPY ek throwaway test DB me daalta hai — prod ko sirf PADHTA hai,
 * kuch likhta NAHI. Iska maqsad: koi bhi bada badlav (points rebuild waghairah) pehle copy
 * par chala kar natija dekh lo, prod ko haath lagaye bina.
 *
 *   node scripts/_clone-to-test-db.js --to office_test_rebuild
 *   node scripts/_clone-to-test-db.js --to office_test_rebuild --from office_management
 *
 * Target ke naam me "test" hona ZAROORI hai — warna script chalegi hi nahi. Prod aur demo
 * target ke taur par hard-block hain.
 *
 * ── COPY ASLI LOGON TAK NAHI PAHUNCHNI CHAHIYE (23 Nov 2026 se) ─────────────────
 *
 * Prod alag DB hai, par LOG wahi hain. Pehle copy me unke phone ki push-registration aur
 * email ka account bhi aa jaata tha, aur backend/.env me asli VAPID aur SMTP ki chaabi
 * hoti hai — to copy par chala koi bhi local backend ya test ASLI push aur email bhejta.
 * Ho bhi gaya: 23 Nov ko local app kholte hi (maybeAnnounceBirthdays dashboard ke saath
 * chalta hai) "Happy Birthday" sach me 8 logon ke phone par gaya.
 *
 *   1. `pushsubscriptions` copy HI NAHI hoti. Local par push khud jaanchni ho to us browser
 *      me ek baar "Enable" dabao — naya registration isi test DB me banega, sirf aapka.
 *
 *   2. Email ka raasta band. Sirf account hatana KAAFI NAHI tha: mailer.js khaali account
 *      par chup-chaap .env ke SMTP_* par chala jaata hai, aur wo bhare hue hain. Isliye HOST
 *      badla jaata hai — mailer host pehle DB se padhta hai, chahe account kahin ka ho — ek
 *      `.invalid` pate par, jo RFC 2606 ke hisaab se kabhi kisi server tak nahi jaata.
 *
 * Websocket (chat) ka raasta local me waise hi band hai: CHAT_WS_ENDPOINT .env me nahi hai.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';

const flag = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const FROM = flag('from') || 'office_management';
const TO = flag('to');
const NEVER = new Set(['office_management', 'office_demo', 'office_ui_demo', 'admin', 'local', 'config']);

// Asli logon tak jaane wali cheezein — inhe copy hi nahi karte (wajah upar likhi hai).
const SKIP = new Set(['pushsubscriptions']);
const MAIL_BAND_HOST = 'clone-mail-band.invalid';

/**
 * Settings ki copy, bina email ke raaste ke. Ye copy karte WAQT hota hai, baad me update karke
 * nahi — warna beech me script tut jaaye to asli account copy me pada reh jaata.
 */
function withoutMail(doc) {
  const d = { ...doc, smtpHost: MAIL_BAND_HOST, smtpPort: 1 };
  delete d.smtpUser;
  delete d.smtpPassEnc;
  return d;
}

if (!TO) throw new Error('--to <dbname> chahiye');
if (!/test/i.test(TO)) throw new Error(`refusing: target "${TO}" ke naam me "test" nahi hai`);
if (NEVER.has(TO)) throw new Error(`refusing: "${TO}" protected hai`);

await connectDB();
const src = mongoose.connection.useDb(FROM);
const dst = mongoose.connection.useDb(TO);

await dst.dropDatabase();
console.log(`\n📋 ${FROM}  →  ${TO}   (target pehle khaali kiya)\n`);

const names = (await src.db.listCollections().toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.')).sort();
let total = 0;
let copied = 0;
for (const name of names) {
  if (SKIP.has(name)) {
    console.log(`       –  ${name}   (jaan-boojh kar chhoda — asli phone)`);
    continue;
  }
  // eslint-disable-next-line no-await-in-loop
  const docs = await src.collection(name).find({}).toArray();
  const out = name === 'settings' ? docs.map(withoutMail) : docs;
  // eslint-disable-next-line no-await-in-loop
  if (out.length) await dst.collection(name).insertMany(out, { ordered: false });
  total += out.length;
  copied += 1;
  console.log(`  ${String(out.length).padStart(6)}  ${name}${name === 'settings' ? '   (email ka raasta band)' : ''}`);
}

// Aakhri jaanch — upar ka koi naam kal badal jaaye to chup-chaap na nikle.
const phones = await dst.collection('pushsubscriptions').countDocuments();
const openMail = await dst.collection('settings').countDocuments({
  $or: [{ smtpHost: { $ne: MAIL_BAND_HOST } }, { smtpUser: { $nin: [null, ''] } }, { smtpPassEnc: { $nin: [null, ''] } }],
});
if (phones || openMail) {
  await disconnectDB();
  throw new Error(`copy SURAKSHIT NAHI: ${phones} phone, ${openMail} settings me email ka raasta khula — ${TO} istemaal mat karna`);
}
console.log(`\n✅ ${total} documents, ${copied} collections → ${TO}   (phone push aur email: band)\n`);
await disconnectDB();
