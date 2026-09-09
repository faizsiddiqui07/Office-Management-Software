/**
 * Dues history ki mahina-war grouping ka test — pure arithmetic, koi DB nahi, koi React
 * nahi. Paise ka mamla hai, isliye har kinara khud chala kar dekha gaya hai.
 *
 * Run (website folder se):  node scripts/test-dues-history.mjs
 */
import { groupByMonth } from '../lib/dues-history.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const due = (id, dateYMD, amount) => ({ id, dateYMD, amount, kind: 'DUE' });
const pay = (id, dateYMD, amount) => ({ id, dateYMD, amount, kind: 'PAYMENT' });

console.log('\n🧪 dues history — mahina-war grouping\n');

// ═══ 1 — mahine sahi bante hain, naye pehle ═══
console.log('1 — mahine alag hote hain, naya mahina sabse upar');
{
  const rows = [due('a', '2026-09-03', 5000), due('b', '2026-08-28', 2000), pay('c', '2026-09-01', 1000)];
  const m = groupByMonth(rows, 'newest');
  check('do mahine bane', m.length === 2, `got ${m.length}`);
  check('September pehle', m[0].key === '2026-09' && m[1].key === '2026-08', m.map((x) => x.key).join(','));
  check('September me 2 entry', m[0].entries.length === 2);
  check('mahine ka naam padha ja sakta hai', /September 2026/.test(m[0].label), m[0].label);
}

// ═══ 2 — mahine ka jod: kitna chadha, kitna aaya ═══
console.log('\n2 — har mahine ka apna jod');
{
  const m = groupByMonth([due('a', '2026-09-03', 5000), due('b', '2026-09-10', 2500), pay('c', '2026-09-05', 3000)], 'newest');
  check('added = sirf DUE ka jod', m[0].added === 7500, String(m[0].added));
  check('received = sirf PAYMENT ka jod', m[0].received === 3000, String(m[0].received));
  check('dueCount sahi', m[0].dueCount === 2, String(m[0].dueCount));
}

// ═══ 3 — teenon sorting ═══
console.log('\n3 — teenon tarah ki sorting');
{
  const rows = [due('a', '2026-09-01', 100), due('b', '2026-09-20', 900), due('c', '2026-09-10', 500)];
  check('newest: 20, 10, 1', eq(groupByMonth(rows, 'newest')[0].entries.map((e) => e.id), ['b', 'c', 'a']));
  check('oldest: 1, 10, 20', eq(groupByMonth(rows, 'oldest')[0].entries.map((e) => e.id), ['a', 'c', 'b']));
  check('largest: 900, 500, 100', eq(groupByMonth(rows, 'largest')[0].entries.map((e) => e.id), ['b', 'c', 'a']));
}

// ═══ 4 — oldest par mahine bhi ulte hone chahiye ═══
console.log('\n4 — "oldest first" par mahine bhi purane se naye');
{
  const m = groupByMonth([due('a', '2026-09-03', 100), due('b', '2026-07-03', 100), due('c', '2026-08-03', 100)], 'oldest');
  check('July, August, September', eq(m.map((x) => x.key), ['2026-07', '2026-08', '2026-09']), m.map((x) => x.key).join(','));
}

// ═══ 5 — bina date wali entry gayab na ho ═══
console.log('\n5 — jiski date hi nahi, wo entry bhi dikhni chahiye (paisa hai)');
{
  const m = groupByMonth([due('a', '2026-09-03', 100), due('b', '', 700), due('c', undefined, 300)], 'newest');
  const un = m.find((x) => x.key === 'undated');
  check('undated ka apna bucket bana', !!un);
  check('dono bina-date wali usme hain', un?.entries.length === 2, String(un?.entries.length));
  check('uska jod bhi sahi', un?.added === 1000, String(un?.added));
  check('ek bhi entry gayab nahi', m.reduce((s, x) => s + x.entries.length, 0) === 3);
}

// ═══ 6 — undated hamesha SABSE NEECHE, chahe sorting koi bhi ho ═══
console.log('\n6 — undated hamesha sabse aakhir me');
{
  for (const sort of ['newest', 'oldest', 'largest']) {
    const m = groupByMonth([due('a', '', 100), due('b', '2026-09-03', 100)], sort);
    check(`${sort}: undated aakhir me`, m[m.length - 1].key === 'undated', m.map((x) => x.key).join(','));
  }
}

// ═══ 7 — mahine ka batwara dateYMD se ho, stored instant se NAHI ═══
console.log('\n7 — mahine ke aakhri din wali entry sahi mahine me jaye');
{
  // 31 August ki entry, jiska stored instant IST-midnight hai (UTC me 30 Aug 18:30).
  // Agar kabhi galti se `date` se group kiya gaya to ye July/August ki seema par
  // khisak jayegi — isiliye ye test yahan hai.
  const m = groupByMonth([{ id: 'a', dateYMD: '2026-08-31', date: '2026-08-30T18:30:00.000Z', amount: 100, kind: 'DUE' }], 'newest');
  check('August me hi hai', m[0].key === '2026-08', m[0].key);
  const m2 = groupByMonth([{ id: 'b', dateYMD: '2026-09-01', date: '2026-08-31T18:30:00.000Z', amount: 100, kind: 'DUE' }], 'newest');
  check('1 September wali September me', m2[0].key === '2026-09', m2[0].key);
}

// ═══ 8 — kinare ke case: khaali, aur ek hi entry ═══
console.log('\n8 — khaali list aur ek hi entry');
{
  check('khaali list par crash nahi, khaali nateeja', eq(groupByMonth([], 'newest'), []));
  check('undefined par bhi', eq(groupByMonth(undefined, 'newest'), []));
  const one = groupByMonth([due('a', '2026-09-03', 100)], 'newest');
  check('ek entry = ek mahina', one.length === 1 && one[0].entries.length === 1);
}

// ═══ 9 — asli input ko chhua na jaye ═══
console.log('\n9 — asli list ka kram badla na jaye (React state hai)');
{
  const rows = [due('a', '2026-09-01', 100), due('b', '2026-09-20', 900)];
  const before = rows.map((r) => r.id).join(',');
  groupByMonth(rows, 'largest');
  check('input list waisi ki waisi', rows.map((r) => r.id).join(',') === before, rows.map((r) => r.id).join(','));
}

// ═══ 10 — ek hi din par kai entry: kram pakka ho (kabhi na badle) ═══
console.log('\n10 — ek hi tareekh par kai entry ka kram sthir rahe');
{
  const rows = [due('b2', '2026-09-03', 100), due('a1', '2026-09-03', 100), due('c3', '2026-09-03', 100)];
  const first = groupByMonth(rows, 'newest')[0].entries.map((e) => e.id).join(',');
  const again = groupByMonth([...rows].reverse(), 'newest')[0].entries.map((e) => e.id).join(',');
  check('dono baar ek hi kram', first === again, `${first}  vs  ${again}`);
}

console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PASS'}\n`);
process.exit(failures ? 1 : 0);
