/**
 * Chat ke kharab "padh liya" nishaan theek karta hai: wo rows jinme readUpToSeq ya
 * deliveredUpToSeq chat ke aakhri number (lastSeq) se UPAR pada hai.
 *
 * Kaise bane: client bhejte waqt galti se temporary bubble ka seq (9007199254740991)
 * "padh liya" me bhej deta tha, aur server use bina jaanche save kar leta tha (24 Oct 2026
 * ko dono taraf theek kiya). Aisi row me:
 *   - us bande ka unread kabhi saaf nahi hota (server har "padh liya" ko pehle se padha maan
 *     kar laut jaata)
 *   - saamne wale ko uske har AANE WALE message par neele tick, bina padhe
 *   - "X new messages" wali line kabhi nahi
 *
 * NAYA NISHAAN KYA HO. Asli nishaan to MAX ne mita diya, isliye wo row me bache sabooton se
 * dobara banaya jaata hai. Jo pakka padha gaya, uske upar tak:
 *   1. is bande ka APNA aakhri TEXT message. Jawab bhejne wala chat me neeche tak tha, aur
 *      sahi system me bhejne ke baad wahi "padh liya" bhejta (chat.js onSettled → refetch →
 *      markRead). Bug yahi rokta tha. File nahi: uska number upload poora hone par milta
 *      hai, jab banda kab ka doosri chat me ja chuka ho sakta hai.
 *   2. `lastReadAt` tak bane message. Kharab karne wale "padh liya" ne hi ye waqt likha tha,
 *      uske baad har koshish laut gayi, to ye theek kharab hone ka pal hai.
 *   3. saamne wale ka wo aakhri message jo isne khud "delete for me" kiya. Delete kiya =
 *      dekha tha.
 * Teeno me jo aage ho, wahi nishaan. Uske baad ke saamne wale ke message unread maane jaate
 * hain, aur `unread` unhi ki ginti se dobara likha jaata hai: sirf un rows se jo DB me sach
 * me hain, aur jo is bande ko dikhti hain ("delete for me" wale nahi; wo chat me dikhte hi
 * nahi, to unka badge kabhi saaf na hota).
 *
 * Pehla niyam galat tha (24 Oct ke review ne pakda): "saamne wale ke aakhri `unread` message
 * bina padhe hain". Par atka hua `unread` un message ko bhi ginta hai jo banda live dekh
 * chuka ya jinka jawab de chuka, kyunki unpar har "padh liya" laut jaata tha. Us niyam se
 * jawab diye gaye message saamne wale ko akele grey tick ke saath dikhte.
 *
 * Badge: sirf apne aakhri jawab ke BAAD aaye message par, aur chat kholte hi saaf. Saamne
 * wale ko unpar grey tick, jab tak khole na jaayein; usse pehle ke sab neele.
 * Kuch saboot na mile (na apna message, na `lastReadAt`): pehle wala niyam, chetavni ke
 * saath.
 *
 *   node scripts/repair-chat-watermarks.js                                  # .env wala DB, sirf dikhata hai
 *   node scripts/repair-chat-watermarks.js --db office_test_x               # kisi aur DB par, sirf dikhata hai
 *   node scripts/repair-chat-watermarks.js --db office_management --apply   # sach me theek karta hai
 * `--apply` ke saath DB ka naam likhna zaroori hai, taaki galti se prod par na likha jaaye.
 *
 * Jis chat me aakhri message abhi-abhi (2 minute ke andar) gaya ho aur uski row abhi na bani
 * ho, wo chhod di jaati hai ("ja raha" message gum maan kar ginti kam ho jaati). Script
 * batati hai; thodi der baad dobara chalao.
 *
 * KAB CHALAANA HAI: naya backend (Lambda) lagne ke TURANT baad. Usse pehle chalaya to purana
 * server nayi kharab rows bana sakta hai.
 *
 * Dobara chalana surakshit hai: theek row dobara kharab nahi dikhti. Aur agar beech me koi
 * row badal gayi (banda chat khol kar khud theek kar gaya, ya naya message aaya), to wo chhod
 * di jaati hai. Dobara chalane par wo pakad li jaati hai.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

// `--db naam` aur `--db=naam` dono. Galat likha (`--db` bina naam) to ruk jao: chupchap .env
// wale DB (prod) par chal jaana sabse bura hota.
const args = process.argv.slice(2);
let DB = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--db') DB = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '';
  else if (args[i].startsWith('--db=')) DB = args[i].slice(5);
}
if (DB === '') {
  console.error('\n--db ke baad DB ka naam likho, jaise: --db office_test_x\n');
  process.exit(1);
}
const APPLY = args.includes('--apply');
// Likhne se pehle DB ka naam saaf likhna zaroori: prod par bhi `--db office_management`.
if (APPLY && !DB) {
  console.error('\n--apply ke saath DB ka naam bhi likho, jaise: --db office_management\n');
  process.exit(1);
}
if (DB) process.env.MONGODB_DB = DB;
/** Is se kam purani chat me aakhri message ki row na mile to wo abhi "ja raha" ho sakta hai. */
const SENDING_MS = 2 * 60 * 1000;

const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { Conversation } = await import('../src/models/Conversation.js');
const { Message } = await import('../src/models/Message.js');
const { User } = await import('../src/models/User.js');

/** Is chat me `filter` se milta sabse bada seq (lastSeq tak), ya 0. */
async function topSeq(convId, last, filter) {
  const row = await Message.findOne({ conversation: convId, seq: { $lte: last }, ...filter })
    .sort({ seq: -1 })
    .select('seq')
    .lean();
  return row?.seq || 0;
}

/** Har kharab member ke liye: abhi kya hai, aur kya hona chahiye. */
async function scan() {
  const convs = await Conversation.find({}).select('members lastSeq lastMessageAt').lean();
  const out = [];
  for (const c of convs) {
    const last = c.lastSeq || 0;
    for (const m of c.members || []) {
      const r = m.readUpToSeq || 0;
      const d = m.deliveredUpToSeq || 0;
      if (r <= last && d <= last) continue;

      const unread = m.unread || 0;
      let newRead = r;
      let newUnread = unread;
      let why = 'padha hua nishaan sahi tha';
      let note = '';
      let skip = '';
      /* eslint-disable no-await-in-loop */
      // Aakhri message abhi "ja raha" ho (number mil gaya, row abhi bani nahi), to use gum
      // maan kar ginti kam ho jaati aur wo message kabhi unread na dikhta. Aisi chat chhodo.
      const fresh = c.lastMessageAt && Date.now() - new Date(c.lastMessageAt).getTime() < SENDING_MS;
      if (r > last && fresh && last > 0 && !(await Message.exists({ conversation: c._id, seq: last }))) {
        skip = `aakhri message #${last} abhi ja raha tha`;
      } else if (r > last) {
        // Sirf TEXT: file ka number upload poora hone par milta hai, jab banda kab ka doosri
        // chat me ja chuka ho sakta hai. Text bhejte waqt wo chat me neeche hi hota hai.
        const ownSeq = await topSeq(c._id, last, { sender: m.user, kind: 'TEXT' });
        const atReadSeq = m.lastReadAt ? await topSeq(c._id, last, { createdAt: { $lte: m.lastReadAt } }) : 0;
        // "Delete for me" kiya = dekha tha. Aur aise message use chat me dikhte bhi nahi, to
        // unhe unread rakhne par wo badge kabhi saaf na hota.
        const hidSeq = await topSeq(c._id, last, { sender: { $ne: m.user }, deletedFor: m.user });
        newRead = Math.max(ownSeq, atReadSeq, hidSeq);
        why = newRead === ownSeq ? `apna aakhri text #${ownSeq}`
          : newRead === hidSeq ? `khud "delete for me" kiya #${hidSeq}`
            : `aakhri baar padhne ke waqt tak #${atReadSeq}`;
        if (!newRead) {
          // Koi saboot nahi. Pehle wala niyam: saamne wale ke aakhri `unread` message bina padhe.
          const theirs = await Message.find({ conversation: c._id, sender: { $ne: m.user }, seq: { $lte: last } })
            .sort({ seq: -1 })
            .limit(Math.max(unread, 1))
            .select('seq')
            .lean();
          newRead = unread > 0 && theirs.length ? theirs[theirs.length - 1].seq - 1 : last;
          why = 'koi saboot nahi mila';
          note = 'na apna message mila na lastReadAt, isliye andaaza unread ki ginti se';
        }
        newRead = Math.min(newRead, last);
        newUnread = await Message.countDocuments({
          conversation: c._id, sender: { $ne: m.user }, seq: { $gt: newRead, $lte: last }, deletedFor: { $ne: m.user },
        });
      }
      /* eslint-enable no-await-in-loop */
      const newDelivered = Math.max(newRead, d > last ? 0 : d);
      const peer = (c.members || []).find((x) => String(x.user) !== String(m.user));
      out.push({ conv: c._id, last, user: m.user, peer: peer?.user, r, d, unread, newRead, newDelivered, newUnread, why, note, skip });
    }
  }
  return out;
}

const big = (n) => (n >= Number.MAX_SAFE_INTEGER ? 'MAX' : String(n));

await connectDB();
console.log(`\nDatabase: ${mongoose.connection.name}   |   Mode: ${APPLY ? '⚠️  APPLY' : 'dry run'}\n`);

const total = await Conversation.countDocuments({});
const rows = await scan();
if (!rows.length) {
  console.log(`${total} chat dekhi — ek bhi kharab nishaan nahi. Kuch karne ko nahi hai.\n`);
  await disconnectDB();
  process.exit(0);
}

const ids = [...new Set(rows.flatMap((x) => [String(x.user), String(x.peer)]))];
const names = new Map((await User.find({ _id: { $in: ids } }).select('name').lean()).map((u) => [String(u._id), u.name]));
const nm = (id) => names.get(String(id)) || `(${String(id).slice(-6)})`;

console.log(`${total} chat me se ${rows.length} member ka nishaan kharab hai:\n`);
for (const x of rows) {
  if (x.skip) {
    console.log(`  ${nm(x.user)}  ↔  ${nm(x.peer)}   (chat ${String(x.conv).slice(-6)}): ⏭️  abhi chhoda, ${x.skip}. Thodi der baad dobara chalao.`);
    continue;
  }
  console.log(`  ${nm(x.user)}  ↔  ${nm(x.peer)}   (chat ${String(x.conv).slice(-6)}, aakhri message #${x.last})`);
  console.log(`      padha:    ${big(x.r)}  →  ${x.newRead}   (${x.why})`);
  console.log(`      pahuncha: ${big(x.d)}  →  ${x.newDelivered}`);
  console.log(`      unread:   ${x.unread}  →  ${x.newUnread}`);
  console.log(`      ${x.newUnread ? `${nm(x.peer)} ko apne aakhri ${x.newUnread} message par grey tick dikhenge, jab tak ${nm(x.user)} chat na khole. Baaki sab neele.` : `${nm(x.peer)} ke sab message padhe hue (neele).`}`);
  if (x.note) console.log(`      ⚠️  ${x.note}`);
}

if (!APPLY) {
  console.log('\n(dry run, kuch nahi badla. Karne ke liye: --apply)\n');
  await disconnectDB();
  process.exit(0);
}

console.log('\nTheek kar raha hoon...\n');
let fixed = 0;
let skipped = 0;
for (const x of rows) {
  if (x.skip) {
    skipped += 1;
    continue;
  }
  // Sirf tab badlo jab row ab bhi WAHI hai jo upar dekhi. Beech me banda chat khol kar aage
  // badh gaya ho (naya server khud theek karta hai), ya naya message aa kar unread badh
  // gaya ho (ginti puraani pad gayi), to chhodo. Dobara chalane par wo pakad liya jaata hai.
  // eslint-disable-next-line no-await-in-loop
  const res = await Conversation.updateOne(
    { _id: x.conv },
    {
      $set: {
        'members.$[m].readUpToSeq': x.newRead,
        'members.$[m].deliveredUpToSeq': x.newDelivered,
        'members.$[m].unread': x.newUnread,
      },
    },
    { arrayFilters: [{ 'm.user': x.user, 'm.readUpToSeq': x.r, 'm.deliveredUpToSeq': x.d, 'm.unread': x.unread }] },
  );
  if (res.modifiedCount) {
    fixed += 1;
    console.log(`  ✅ ${nm(x.user)} ↔ ${nm(x.peer)}`);
  } else {
    skipped += 1;
    console.log(`  ⏭️  ${nm(x.user)} ↔ ${nm(x.peer)}: beech me badal chuka tha, chhoda (dobara chalao)`);
  }
}

const left = await scan();
console.log(`\n${fixed} theek, ${skipped} chhode.`);
console.log(left.length ? `❌ RUKO: abhi bhi ${left.length} kharab bache hain. Script dobara chalao.\n` : '✅ Ab ek bhi kharab nishaan nahi bacha.\n');

await disconnectDB();
