/**
 * Notification ke SHABD ka test. Koi DB nahi, koi ghadi nahi (waqt inject hota hai).
 *
 * Owner ne phone ka screenshot bheja (2 Nov 2026): notification me mote akshar me
 * "New task from ADMIN. CO…" dikh raha tha — kata hua — aur kaam ka naam neeche chhote
 * grey akshar me. Android pehli line mota dikhata hai aur doosri dhundhli, aur app ka
 * apna bell list bhi bilkul yahi karta hai — dono ek-ek line me kaat dete hain. Yaani jo
 * baat har baar wahi rehti hai wo sabse upar thi, aur asli khabar neeche.
 *
 * Isliye ab kaam ka naam pehle, sentence baad me — aur tareekh insaan ki zabaan me.
 *
 * Yahan galti ka matlab: kisi ko khabar galat padhi jaaye, ya (jaisa ek baar hua)
 * notification banate waqt crash ho jaye aur poora save hi gir jaye.
 *
 * Run (backend folder se):  node scripts/test-notification-text.js
 */
import { dayInWords } from '../src/lib/time.js';
import { taskNews } from '../src/services/task.service.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}

console.log('\n🧪 notification ke shabd\n');

// 2 Nov 2026, 11:30 IST — screenshot wala din.
const NOW = new Date('2026-11-02T06:00:00Z');

console.log('1 — dayInWords: tareekh insaan ki zabaan me');
{
  check('aaj', dayInWords('2026-11-02', NOW) === 'today', dayInWords('2026-11-02', NOW));
  check('kal (aage)', dayInWords('2026-11-03', NOW) === 'tomorrow');
  check('kal (peeche)', dayInWords('2026-11-01', NOW) === 'yesterday');
  check('aage ka din — vaar ke saath', dayInWords('2026-11-04', NOW) === 'Wed 4 Nov', dayInWords('2026-11-04', NOW));
  check('usi saal me saal nahi likha jaata', dayInWords('2026-12-25', NOW) === 'Fri 25 Dec');
  check('agle saal me saal bhi', dayInWords('2027-01-03', NOW) === 'Sun 3 Jan 2027', dayInWords('2027-01-03', NOW));
  check('pichhle saal me bhi saal', dayInWords('2025-12-31', NOW) === 'Wed 31 Dec 2025', dayInWords('2025-12-31', NOW));
}

console.log('\n2 — dayInWords KABHI crash na kare (ye save ke beech chalta hai)');
{
  // Pehle ye RangeError phenkta tha: shakal theek hai, din calendar me hai hi nahi.
  // Notification banate waqt throw hona matlab wo poora save gir jaana jo khabar dene ja
  // raha tha — isliye yahan jawab dena zaroori hai, chahe bhadda ho.
  check("'2026-02-29' (non-leap) par crash nahi, raw string", dayInWords('2026-02-29', NOW) === '2026-02-29', dayInWords('2026-02-29', NOW));
  check("'2026-13-40' par bhi jawab", typeof dayInWords('2026-13-40', NOW) === 'string');
  check('khaali par khaali', dayInWords('', NOW) === '');
  check('null par khaali, crash nahi', dayInWords(null, NOW) === '');
  check('undefined par khaali', dayInWords(undefined, NOW) === '');
  check('number par khaali', dayInWords(20261104, NOW) === '');
  check("'kal' par khaali", dayInWords('kal', NOW) === '');
  check('leap saal ka 29 Feb asli hai', dayInWords('2028-02-29', NOW) === 'Tue 29 Feb 2028', dayInWords('2028-02-29', NOW));
}

console.log('\n3 — taskNews: kaam ka naam UPAR, sentence NEECHE');
{
  // Screenshot wala theek wahi mamla.
  const n = taskNews('testing', 'New task from ADMIN. CONTROLLER', { due: '2026-11-04' });
  check('mote akshar me kaam ka naam', n.title === 'testing', n.title);
  check('neeche: kisne diya + kab tak', n.message === 'New task from ADMIN. CONTROLLER · due Wed 4 Nov', n.message);

  const t = taskNews('Site visit', 'Asha tagged you', { due: '2026-11-03' });
  check('kal wali tareekh bhi shabdon me', t.message === 'Asha tagged you · due tomorrow', t.message);

  const nd = taskNews('Site visit', 'Asha tagged you');
  check('due na ho to "due" likha hi na jaye', nd.message === 'Asha tagged you', nd.message);

  const wn = taskNews('Drawing set', 'Asha sent it back', { note: 'Scale galat hai' });
  check('wajah bhi usi line me', wn.message === 'Asha sent it back · Scale galat hai', wn.message);

  const both = taskNews('Drawing set', 'Asha sent it back', { due: '2026-11-02', note: 'Scale galat hai' });
  check('teenon ek saath, kram tay', both.message === 'Asha sent it back · due today · Scale galat hai', both.message);

  // Khaali hisse beech me do separator na chhod dein.
  const empty = taskNews('Drawing set', 'Asha approved it', { due: '', note: '' });
  check('khaali hisse gire, dohra separator nahi', empty.message === 'Asha approved it', JSON.stringify(empty.message));
  check('note undefined par bhi saaf', taskNews('X', 'Y', { note: undefined }).message === 'Y');
  check('bina options ke bhi chale', taskNews('X', 'Y').message === 'Y');

  // Title kabhi khaali na chhoote — mota akshar khaali dikhega.
  check('title hamesha kaam ka naam', taskNews('Ek lamba kaam ka naam', 'Z').title === 'Ek lamba kaam ka naam');
}

console.log('\n4 — purani shakal dobara na aa jaye');
{
  const n = taskNews('testing', 'New task from ADMIN. CONTROLLER', { due: '2026-11-04' });
  check('title me "New task from" NAHI hai', !n.title.includes('New task from'), n.title);
  check('kahin bhi raw YYYY-MM-DD nahi', !/\d{4}-\d{2}-\d{2}/.test(`${n.title} ${n.message}`), n.message);
  check('purana "(due …)" bracket wala roop nahi', !n.message.includes('(due'), n.message);
}

console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PASS'}\n`);
process.exit(failures ? 1 : 0);
