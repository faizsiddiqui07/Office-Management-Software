/**
 * lib/chat-cache.js ke chaaron pure function — seedhe chala kar.
 *
 * Ye file isliye zaroori hai ki chat ka WebSocket local par chalta hi nahi: saamne wale
 * ka message aane wala poora raasta browser me khud se kabhi chalta hi nahi. Yahan wahi
 * raasta haath se chalaya jaata hai.
 *
 * Jo niyam jaanche ja rahe hain:
 *   1. apna bheja message kabhi DO bubble me na dikhe
 *   2. asli message hamesha `seq` ke kram me; jo abhi ja raha hai wo sabse neeche
 *   3. "padh liya" me kabhi temporary bubble ka 9007199254740991 na jaaye
 *   4. saamne wale ke "padh liya" se koi sahi neela tick grey na ho
 *   5. saamne wale ka message aate hi is chat ki apni unread ginti badhe — warna chat
 *      KHULI hone par bhi wo padha hua nahi mana jaata tha
 *
 * Run (website folder se):  node scripts/test-chat-cache.mjs
 */
import {
  mergeIncomingMessage as merge, settleSentMessage as settle, lastRealSeq, applyPeerRead,
} from '../lib/chat-cache.js';

const ME = 'u-me';
const PEER = 'u-peer';
const MAX = Number.MAX_SAFE_INTEGER;
let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log('  ✅ ' + label); } else { fail += 1; console.log('  ❌ ' + label + '  — ' + extra); }
};

const base = () => ({ pages: [{ messages: [
  { id: 'a', seq: 10, mine: false, text: 'hello' },
  { id: 'b', seq: 11, mine: true, text: 'hi' },
] }, { messages: [{ id: 'old', seq: 3, text: 'purana' }] }] });
const temp = (id, text) => ({ id, seq: MAX, mine: true, pending: true, text });
const server = (seq, text, sender = ME) => ({ id: 'm' + seq, seq, sender, kind: 'TEXT', text, createdAt: 'now' });
const withTemps = (...t) => { const c = base(); c.pages[0].messages.push(...t); return c; };
const texts = (c) => c.pages[0].messages.map((m) => `${m.text}${m.pending ? '(temp)' : ''}#${m.seq === MAX ? 'MAX' : m.seq}`).join(',');

console.log('1) echo PEHLE, jawab BAAD (aam haalat)');
{ let c = withTemps(temp('t1', 'kal milte hain'));
  c = merge(c, server(12, 'kal milte hain'), ME);
  ok(texts(c) === 'hello#10,hi#11,kal milte hain#12', 'echo ne temporary badla, naya bubble nahi', texts(c));
  ok(c.pages[0].messages[2].mine === true, 'mine: true');
  const before = c;
  c = settle(c, server(12, 'kal milte hain'), 't1');
  ok(c === before, 'jawab aaya: kuch badla nahi (temporary pehle hi ja chuka)');
}
console.log('2) jawab PEHLE, echo BAAD (socket dheema)');
{ let c = withTemps(temp('t1', 'ok'));
  c = settle(c, server(12, 'ok'), 't1');
  ok(texts(c) === 'hello#10,hi#11,ok#12', 'jawab ne temporary ko asli kiya', texts(c));
  const before = c;
  c = merge(c, server(12, 'ok'), ME);
  ok(c === before, 'baad wala echo seq se pehchana, nahi joda');
}
console.log('3) socket hi nahi (local) — sirf jawab');
{ const c = settle(withTemps(temp('t1', 'test')), server(12, 'test'), 't1');
  ok(c.pages[0].messages.filter((m) => m.text === 'test').length === 1, 'ek hi bubble', texts(c));
}
console.log('4) tez-tez do ek jaise message ("ok", "ok")');
{ let c = withTemps(temp('t1', 'ok'), temp('t2', 'ok'));
  c = merge(merge(c, server(12, 'ok'), ME), server(13, 'ok'), ME);
  ok(texts(c) === 'hello#10,hi#11,ok#12,ok#13', 'dono apne temporary badle, kram 12 phir 13', texts(c));
  c = settle(settle(c, server(12, 'ok'), 't1'), server(13, 'ok'), 't2');
  ok(texts(c) === 'hello#10,hi#11,ok#12,ok#13', 'jawabon ke baad bhi wahi', texts(c));
}
console.log('5) do alag message, echo ULTE kram me (B pehle)');
{ let c = withTemps(temp('t1', 'A'), temp('t2', 'B'));
  c = merge(c, server(13, 'B'), ME);
  ok(texts(c) === 'hello#10,hi#11,B#13,A(temp)#MAX', 'B ne apna hi (t2) badla; A abhi ja raha hai to neeche', texts(c));
  c = merge(c, server(12, 'A'), ME);
  ok(texts(c) === 'hello#10,hi#11,A#12,B#13', 'aakhir me seq kram, koi duplicate nahi', texts(c));
}
console.log('6) saamne wale ka same text — mera temporary na chhue');
{ const c = merge(withTemps(temp('t1', 'hi')), server(12, 'hi', PEER), ME);
  ok(texts(c) === 'hello#10,hi#11,hi#12,hi(temp)#MAX', 'peer ka alag juda, mera temporary waise hi aur neeche', texts(c));
  ok(c.pages[0].messages[2].mine === false, 'peer wala mine:false');
}
console.log('7) echo ka matn alag (kisi wajah se) — fallback');
{ let c = merge(withTemps(temp('t1', 'abc')), server(12, 'abc-changed'), ME);
  ok(c.pages[0].messages.length === 4, 'milaan nahi hua to alag juda', texts(c));
  c = settle(c, server(12, 'abc-changed'), 't1');
  ok(texts(c) === 'hello#10,hi#11,abc-changed#12', 'jawab ne bacha temporary hataya', texts(c));
}
console.log('8) chat khuli hi nahi (cache khaali)');
{ ok(merge(undefined, server(1, 'x'), ME) === undefined, 'merge: undefined waisa hi');
  ok(settle(undefined, server(1, 'x'), 't') === undefined, 'settle: undefined waisa hi'); }
console.log('9) purane page nahi chhuye');
{ const c0 = withTemps(temp('t1', 'z')); const oldPage = c0.pages[1];
  ok(merge(c0, server(12, 'z'), ME).pages[1] === oldPage, 'pages[1] wahi object'); }
console.log('10) CROSSING: mera "hi" bhejte hi saamne wale ka "hello" (41) aaya, mera asli 42');
{ let c = merge(withTemps(temp('t1', 'hi')), server(41, 'hello', PEER), ME);
  ok(texts(c) === 'hello#10,hi#11,hello#41,hi(temp)#MAX', 'peer wala temporary se PEHLE juda', texts(c));
  c = merge(c, server(42, 'hi'), ME);
  ok(texts(c) === 'hello#10,hi#11,hello#41,hi#42', 'mera 42 peer ke 41 ke BAAD — seq kram', texts(c));
}
console.log('11) CROSSING, jawab pehle (socket nahi)');
{ const c = settle(merge(withTemps(temp('t1', 'hi')), server(41, 'hello', PEER), ME), server(42, 'hi'), 't1');
  ok(texts(c) === 'hello#10,hi#11,hello#41,hi#42', 'settle ne bhi seq kram rakha', texts(c)); }
console.log('12) peer ka message der se pahuncha (mera pehle hi asli ho chuka)');
{ const c = merge(merge(withTemps(temp('t1', 'hi')), server(42, 'hi'), ME), server(41, 'hello', PEER), ME);
  ok(texts(c) === 'hello#10,hi#11,hello#41,hi#42', 'der wala 41 apni jagah, 42 se pehle', texts(c)); }

// ── "padh liya" ka number ─────────────────────────────────────────────────────
const msg = (seq, mine = false, extra = {}) => ({ id: 'm' + seq, seq, mine, text: 't' + seq, ...extra });

console.log('13) lastRealSeq');
ok(lastRealSeq([]) === 0, 'khaali list → 0');
ok(lastRealSeq(undefined) === 0, 'undefined → 0');
ok(lastRealSeq([msg(40), msg(41)]) === 41, 'aam list → aakhri');
ok(lastRealSeq([msg(40), msg(41), temp('t1', 'hi')]) === 41, 'temporary ant me → usse pehle wala (PURANA code yahan MAX deta)');
ok(lastRealSeq([msg(40), temp('t1', 'a'), temp('t2', 'b')]) === 40, 'do temporary → asli');
ok(lastRealSeq([temp('t1', 'a')]) === 0, 'sirf temporary (nayi chat ka pehla message) → 0, markRead chalega hi nahi');
ok(lastRealSeq([msg(40), msg(42), msg(41)]) === 42, 'kram bigda ho tab bhi sabse bada');
ok(lastRealSeq([msg(40), { id: 'x', seq: MAX }]) === 40, 'pending flag na ho par seq MAX ho → phir bhi nahi');

console.log('14) asli bhejne ka kram: temporary → asli; markRead ko kya number milta');
{ const b0 = { pages: [{ conversation: { myUnread: 3 }, messages: [msg(40), msg(41)] }] };
  const flat = (c) => [...c.pages].reverse().flatMap((p) => p.messages);
  const withTemp = { pages: [{ ...b0.pages[0], messages: [...b0.pages[0].messages, temp('t1', 'ok')] }] };
  ok(lastRealSeq(flat(withTemp)) === 41, 'temporary ke dauraan: 41 (pehle 9007199254740991 jaata)');
  ok(lastRealSeq(flat(settle(withTemp, { id: 'm42', seq: 42, text: 'ok' }, 't1'))) === 42, 'jawab ke baad: 42');
  ok(lastRealSeq(flat(merge(withTemp, server(42, 'ok'), ME))) === 42, 'echo ke baad: 42');
}

const cache = (read, delivered, seqs = [40, 41, 42]) => ({
  pages: [
    { conversation: { peerReadUpToSeq: read, peerDeliveredUpToSeq: delivered }, messages: seqs.map((s) => msg(s, true)) },
    { messages: [msg(10, true)] },
  ],
});

console.log('15) applyPeerRead — aam haalat');
{ const c = cache(40, 40);
  const { data, backward } = applyPeerRead(c, 42);
  ok(data.pages[0].conversation.peerReadUpToSeq === 42 && data.pages[0].conversation.peerDeliveredUpToSeq === 42, 'read 40 → 42');
  ok(backward === false, 'aage badha, backward nahi');
  ok(data.pages[1] === c.pages[1], 'purana page wahi object');
}
{ const { data } = applyPeerRead(cache(40, 41), 41);
  ok(data.pages[0].conversation.peerReadUpToSeq === 41 && data.pages[0].conversation.peerDeliveredUpToSeq === 41, 'delivered pehle se 41, read 41 tak');
}
{ const c = cache(42, 42);
  const r = applyPeerRead(c, 42);
  ok(r.data === c && r.backward === false, 'wahi number dobara → kuch nahi badla');
}

console.log('16) applyPeerRead — naamumkin number chhoda (purana server)');
{ const c = cache(40, 40);
  const r = applyPeerRead(c, MAX);
  ok(r.data === c && r.backward === false, 'MAX aaya → chhoda, read 40 hi (koi jhootha neela nahi)');
}
{ const c = cache(40, 40); c.pages[0].messages.push(temp('t1', 'jaa raha'));
  ok(applyPeerRead(c, MAX).data === c, 'temporary ke saath bhi MAX chhoda'); }
ok(applyPeerRead(cache(40, 40), 'abc').data.pages[0].conversation.peerReadUpToSeq === 40, 'bakwaas text → kuch nahi');
ok(applyPeerRead(cache(40, 40), -3).data.pages[0].conversation.peerReadUpToSeq === 40, 'ulta number → kuch nahi');
ok(applyPeerRead(cache(40, 40), Infinity).data.pages[0].conversation.peerReadUpToSeq === 40, 'Infinity → kuch nahi');

console.log('17) "padh liya 41" mere #41 ke echo se PEHLE aaya (doosra tab/device)');
{ let c = cache(40, 40, [39, 40]);
  c = applyPeerRead(c, 41).data;
  ok(c.pages[0].conversation.peerReadUpToSeq === 41, 'cache me 41 yaad (pehle 40 par kat jaata)');
  c = merge(c, server(41, 'x'), ME);
  const m41 = c.pages[0].messages.find((m) => m.seq === 41);
  ok(m41 && m41.seq <= c.pages[0].conversation.peerReadUpToSeq, '#41 aate hi neela');
}

console.log('18) applyPeerRead — kharab nishaan theek hua (server ne peeche kiya)');
{ const c = cache(MAX, MAX);
  const r = applyPeerRead(c, 41);
  ok(r.backward === true, 'MAX cache me, 41 aaya → backward: refetch karo');
  ok(r.data === c, 'cache khud nahi badla (refetch sach laayega)');
}
{ const r = applyPeerRead(cache(42, 42), 41);
  ok(r.backward === false && r.data.pages[0].conversation.peerReadUpToSeq === 42, 'ulte kram me aaya purana event → refetch NAHI, 42 hi rehta');
}

console.log('19) applyPeerRead — kinare');
ok(applyPeerRead(undefined, 5).data === undefined, 'cache nahi → undefined');
{ const c = { pages: [{ messages: [msg(1)] }] };
  ok(applyPeerRead(c, 1).data === c, 'conversation header nahi → waisa hi'); }
{ const c = cache(0, 0, []);
  ok(applyPeerRead(c, 0).data === c, '0 → kuch nahi'); }
{ const c = cache(50, 50, [48, 49]);
  const r = applyPeerRead(c, 50);
  ok(r.data === c && r.backward === false, 'delete-for-me ke baad: sahi 50 cache me waisa hi, kuch nahi toota');
}

// ── Chat KHULI hone par bhi "padha hua nahi" (owner, 27 Oct 2026) ────────────
console.log('20) saamne wale ka message aate hi apni unread ginti badhe');
{ const open = { pages: [{ conversation: { myUnread: 0, peerReadUpToSeq: 0, peerDeliveredUpToSeq: 0 }, messages: [msg(40)] }] };
  const after = merge(open, server(41, 'naya', PEER), ME);
  ok(after.pages[0].conversation.myUnread === 1, 'peer ka message → myUnread 0 se 1 (PURANA code 0 hi chhodta tha, aur markRead kabhi chalta hi nahi tha)',
    String(after.pages[0].conversation.myUnread));
  const two = merge(after, server(42, 'aur ek', PEER), ME);
  ok(two.pages[0].conversation.myUnread === 2, 'doosra peer message → 2', String(two.pages[0].conversation.myUnread));
  const mineEcho = merge(two, server(43, 'mera'), ME);
  ok(mineEcho.pages[0].conversation.myUnread === 2, 'apna hi echo → ginti nahi badhi (apne liye unread hota hi nahi)',
    String(mineEcho.pages[0].conversation.myUnread));
  ok(lastRealSeq(mineEcho.pages[0].messages) === 43, '…aur markRead ko 43 milega, yaani teeno padhe hue jaayenge');
}
{ const noHeader = { pages: [{ messages: [msg(40)] }] };
  ok(merge(noHeader, server(41, 'x', PEER), ME).pages[0].conversation === undefined, 'header hai hi nahi → kuch nahi toota');
}
{ const dup = { pages: [{ conversation: { myUnread: 5 }, messages: [msg(41, false)] }] };
  ok(merge(dup, server(41, 'x', PEER), ME).pages[0].conversation.myUnread === 5, 'wahi seq dobara aaya → ginti nahi badhi');
}

console.log(`\n${fail ? 'FAIL' : 'PAAS'}: ${pass} paas, ${fail} fail`);
process.exit(fail ? 1 : 0);
