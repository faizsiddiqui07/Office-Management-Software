/**
 * Chat ke message-cache ko badalne wale do saaf function — koi React, koi network nahi.
 *
 * Alag file isliye: dono ki galti ka nateeja ek hi hai (apna bheja message pal bhar ke liye
 * DO baar dikhna — owner ki shikayat, 24 Oct 2026), aur dono ko seedha chala kar parkha ja
 * sake. Local par chat ka WebSocket chalta hi nahi, to socket wala raasta browser me khud
 * se kabhi nahi chalta — ye function hi uski jaanch ka zariya hain.
 *
 * Cache ka roop (react-query infinite): `{ pages: [{ messages: [...] }, ...] }`, aur
 * `pages[0]` sabse naya page hai — naye message usi ke ant me judte hain.
 *
 * Temporary bubble (useSendMessage ka): `{ id: 'temp-…', seq: MAX_SAFE_INTEGER,
 * pending: true, mine: true, text }`. Uska `seq` jaan-boojhkar sabse bada hai taaki wo
 * neeche rahe — isiliye `seq` se milaan karne par wo kabhi asli message se nahi milta tha.
 */

/**
 * Asli message ko `seq` ke kram me sahi jagah daalo; temporary (pending) bubble hamesha
 * ant me rehte hain.
 *
 * Temporary ko "usi jagah" badalna kaafi nahi tha: maine "hi" likha (temporary ant me
 * juda), usi beech saamne wale ka "hello" (seq 41) aa kar uske BAAD juda, phir mera asli
 * (seq 42) temporary ki jagah baith gaya — list [40, 42 hi, 41 hello] ban jaati, yaani
 * mera message purane message ke UPAR, refetch tak. Review ne pakda (24 Oct 2026).
 */
function insertBySeq(list, msg) {
  let i = list.length;
  while (i > 0 && (list[i - 1].pending || list[i - 1].seq > msg.seq)) i -= 1;
  return [...list.slice(0, i), msg, ...list.slice(i)];
}

/**
 * Socket se aaya `chat:message` cache me jodo.
 *
 * - Pehle se hai (same `seq`): kuch mat karo — HTTP jawab ya reconnect ki bharpai le aayi.
 * - APNA hai aur uska temporary list me hai: temporary hatao aur asli ko `seq` ke kram me
 *   daalo. Server echo HTTP jawab se pehle bhejta hai, to aksar yahi raasta chalta hai.
 *   Milaan matn se: server bhi sirf `trim()` karta hai, client bhi — matn bilkul wahi.
 *   PEHLA milta hua temporary — tez-tez bheje do ek jaise message apne kram me badlein.
 * - Warna (saamne wale ka, ya milaan na hua): `seq` ke kram me daalo.
 *
 * @param {object} old   cache
 * @param {object} m     server ka message (`sender`, `seq`, `text`, …)
 * @param {string|null} myId
 * @returns {object} naya cache (ya wahi `old` agar kuch nahi badla)
 */
export function mergeIncomingMessage(old, m, myId) {
  if (!old?.pages?.length) return old; // ye chat abhi kholi hi nahi — list refresh kaafi hai
  if (old.pages.some((p) => p.messages?.some((x) => x.seq === m.seq))) return old;

  // Server dono taraf ek hi event bhejta hai, isliye "mera hai ya nahi" client hi tay
  // karta hai — apne id se milaa kar.
  const mine = !!myId && String(m.sender) === myId;
  const real = {
    id: m.id,
    seq: m.seq,
    mine,
    sender: m.sender,
    kind: m.kind,
    text: m.text,
    // Server file bhejta hai; ise chhod dene par live aayi photo/PDF bina attachment ke
    // dikhti thi jab tak refetch na ho.
    file: m.file ?? null,
    deleted: false,
    replyTo: m.replyTo ? { seq: m.replyTo.seq, mine: false, text: m.replyTo.text } : null,
    createdAt: m.createdAt,
  };

  const pages = [...old.pages];
  let list = pages[0].messages || [];
  if (mine) {
    const i = list.findIndex((x) => x.pending && (x.text ?? '') === (m.text ?? ''));
    if (i !== -1) list = [...list.slice(0, i), ...list.slice(i + 1)];
  }
  pages[0] = { ...pages[0], messages: insertBySeq(list, real) };
  // Saamne wale ka message aaya → is chat ki apni "kitne bina padhe" ginti bhi badhao.
  //
  // Bina iske: chat KHULI hone par bhi wo message padha hua nahi mana jaata tha. Wajah —
  // conversation-view ka mark-read effect tabhi chalta hai jab cache me `myUnread` 0 se
  // bada ho, aur ye ginti sirf server se aati thi. Chat kholte hi wo 0 ho jaati, aur
  // socket se aaye naye message usse chhedte hi nahi the. Natija: us khuli chat par list
  // me "1" ka badge, aur saamne wale ko grey tick — jabki banda message saamne padh raha
  // hota. (Owner ne pakda, 27 Oct 2026.) Ab ginti badhti hai, effect chalta hai, aur
  // server turant "padh liya" likh deta hai.
  //
  // Apne hi message (doosre tab ka echo) par nahi — wo apne liye unread hota hi nahi.
  if (!mine && pages[0].conversation) {
    pages[0] = { ...pages[0], conversation: { ...pages[0].conversation, myUnread: (pages[0].conversation.myUnread || 0) + 1 } };
  }
  return { ...old, pages };
}

/**
 * Server ne bhejne ka jawab diya — temporary bubble ko asli se badlo.
 *
 * Jo PEHLE pahunche wahi kaam karta hai:
 * - socket echo pehle aaya: usne temporary badal diya hoga (to yahan wo milega hi nahi),
 *   ya matn na milne par asli alag jod diya hoga. Asli `seq` list me hai → bacha hua
 *   temporary bas hata do.
 * - jawab pehle aaya (socket band/dheema): temporary hatao, asli ko `seq` ke kram me daalo.
 *   Baad me echo aayega to `seq` se pehchan kar chhod diya jaayega.
 *
 * @param {object} old     cache
 * @param {object} msg     server ka jawab (asli message)
 * @param {string} tempId  useSendMessage ka temporary id
 */
export function settleSentMessage(old, msg, tempId) {
  if (!old?.pages?.length || !msg?.seq || !tempId) return old;
  const already = old.pages.some((p) => p.messages?.some((x) => x.seq === msg.seq));
  let changed = false;
  const pages = old.pages.map((p) => {
    const at = p.messages?.findIndex((x) => x.id === tempId) ?? -1;
    if (at === -1) return p;
    changed = true;
    const without = [...p.messages.slice(0, at), ...p.messages.slice(at + 1)];
    return { ...p, messages: already ? without : insertBySeq(without, { ...msg, mine: true, deleted: false }) };
  });
  return changed ? { ...old, pages } : old;
}

/**
 * List ka sabse bada ASLI seq — "main yahan tak padh chuka" isi se bataya jaata hai.
 *
 * Temporary bubble (pending) ko chhodna hi iska kaam hai. Pehle yahan seedha list ka
 * aakhri message liya jaata tha. Bhejte waqt wo temporary hota hai, jiska seq
 * MAX_SAFE_INTEGER (9007199254740991) hai, aur wahi number server ko "padh liya" me chala
 * jaata tha. Server use save kar leta, aur us chat ka unread phir kabhi saaf na hota.
 * Saamne wale ko har aane wale message par jhoothe neele tick dikhte. Review ne pakda
 * (24 Oct 2026). Server bhi ab aisa number kaat deta hai (chat.service.js markRead); ye
 * client ki taraf ka bachaav hai.
 *
 * Aakhri ki jagah sabse bada: kram kabhi bigde tab bhi number sahi rahe.
 *
 * @param {Array<{seq:number, pending?:boolean}>} messages
 * @returns {number} 0 agar koi asli message nahi
 */
export function lastRealSeq(messages) {
  let top = 0;
  for (const m of messages || []) {
    if (!m.pending && m.seq < Number.MAX_SAFE_INTEGER && m.seq > top) top = m.seq;
  }
  return top;
}

/**
 * Saamne wale ne padha (`chat:read`) — mere bubbles ke tick neele karo.
 *
 * Naamumkin number (temporary bubble wala MAX_SAFE_INTEGER, ulta, ya bakwaas) chhod diya
 * jaata hai. Server ab number `lastSeq` par kaatta hai, to ye sirf purane server ke liye
 * bachaav hai.
 *
 * Cache ke sabse bade seq par JAAN-BOOJHKAR nahi kaata (review, 24 Oct 2026). Maine phone
 * se #41 bheja, laptop par chat khuli hai. Saamne wale ka "padh liya 41" laptop par #41 ke
 * echo se pehle pahunch sakta hai (dono alag-alag bheje jaate hain). Kaatne par laptop 40
 * yaad rakhta, aur #41 aane par bhi akela grey tick dikhata, refetch tak.
 *
 * Nishaan sirf aage badhta hai. `backward: true` sirf tab, jab cache me wahi KHARAB MAX
 * pada ho (purane bug ka nishaan) aur server ne theek number bheja. Tab cache ka number hi
 * jhootha hai, isliye bulane wala refetch kare. Ulte kram me aaye aam events (41 ke baad 40)
 * par refetch NAHI (review, 24 Oct): server ka write ek saath aaye do "padh liya" me kabhi
 * chhota number bhi chhod deta hai, aur refetch wahi utha kar sahi neela tick grey kar deta.
 *
 * @param {object} old       messages cache
 * @param {number} upToSeq   event ka number
 * @returns {{ data: object, backward: boolean }}
 */
export function applyPeerRead(old, upToSeq) {
  const conv = old?.pages?.[0]?.conversation;
  const upto = Number(upToSeq);
  if (!conv || !Number.isFinite(upto) || upto <= 0 || upto >= Number.MAX_SAFE_INTEGER) {
    return { data: old, backward: false };
  }
  const read = conv.peerReadUpToSeq || 0;
  const delivered = conv.peerDeliveredUpToSeq || 0;
  const backward = upto < read && read >= Number.MAX_SAFE_INTEGER;
  if (upto <= read && upto <= delivered) return { data: old, backward };
  const pages = [...old.pages];
  pages[0] = {
    ...pages[0],
    conversation: { ...conv, peerReadUpToSeq: Math.max(read, upto), peerDeliveredUpToSeq: Math.max(delivered, upto) },
  };
  return { data: { ...old, pages }, backward };
}
