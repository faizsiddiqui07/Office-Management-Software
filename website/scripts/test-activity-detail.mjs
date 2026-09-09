/**
 * Activity log ki detail line ka test.
 *
 * Ye test isliye hai kyunki yahan ek asli bug pakda gaya tha: is app me paisa PAISE me
 * store hota hai (₹40 = 4000), aur log ki nayi detail line usi 4000 ko seedha chhaap
 * rahi thi — screen par ₹4,000 padha jaa raha tha. Amount sahi tha, dikhawa galat.
 * Neeche ke numbers seedhe us screenshot se liye gaye hain.
 *
 * Run (website folder se):  node scripts/test-activity-detail.mjs
 */
import { detailOf, humanize } from '../lib/activity-detail.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}
const rupees = (s) => s.replace(/ /g, ' '); // Intl patli space daalta hai

console.log('\n🧪 activity log — detail line\n');

// ═══ 1 — WAHI BUG: paise ko rupees samajh kar mat chhapo ═══
console.log('1 — dues ka amount rupees me dikhe, paise ke ginti me nahi');
{
  const line = rupees(detailOf({ action: 'dues.add', meta: { person: 'Mohd Faiz', personId: '6a44be79097c1b62f2321120', amount: 4000 } }));
  check('4000 paise = ₹40, ₹4,000 nahi', line.includes('₹40.00') && !line.includes('4,000'), line);
  const l2 = rupees(detailOf({ action: 'dues.add', meta: { person: 'Khaan Aamir', amount: 13000 } }));
  check('13000 paise = ₹130', l2.includes('₹130.00'), l2);
  const l3 = rupees(detailOf({ action: 'expense.create', meta: { amount: 250000, category: 'Travel' } }));
  check('expense bhi paise hi hai → ₹2,500', l3.includes('₹2,500'), l3);
}

// ═══ 2 — jo paisa NAHI hai use chhua na jaye ═══
console.log('\n2 — jo number paisa nahi hai wo waisa ka waisa rahe');
{
  const l = detailOf({ action: 'bonus.award', meta: { amount: 10 } });
  check('points ka 10, ₹0.10 nahi bana', l.includes('10') && !l.includes('₹'), l);
  const l2 = detailOf({ action: 'task.delete', meta: { title: 'Site survey', cascaded: 2 } });
  check('cascaded ginti rupees nahi bani', !l2.includes('₹'), l2);
}

// ═══ 3 — kachcha ObjectId aankhon ke liye kachra hai ═══
console.log('\n3 — 24-character id line me na aaye');
{
  const l = detailOf({ action: 'dues.add', meta: { person: '6a44be79097c1b62f2321120', amount: 4000 } });
  check('id nahi chhapi', !l.includes('6a44be79'), l);
  check('phir bhi amount to dikhe', rupees(l).includes('₹40.00'), l);
  const l2 = detailOf({ action: 'dues.settle', meta: { person: '6a44be79097c1b62f2321120' } });
  check('sirf id ho to line khaali rahe, kachra nahi', l2 === '', JSON.stringify(l2));
}

// ═══ 4 — naam ho to naam dikhe ═══
console.log('\n4 — naam maujood ho to wahi dikhe');
{
  const l = detailOf({ action: 'dues.add', meta: { person: 'Mariya Khan', personId: '6a44be79097c1b62f2321120', amount: 4000 } });
  check('naam aaya', l.includes('Mariya Khan'), l);
  check('uske saath id nahi ghusi', !l.includes('6a44be79'), l);
}

// ═══ 5 — task wale naye actions ═══
console.log('\n5 — task ki entries');
{
  check('update: kaun se field badle',
    detailOf({ action: 'task.update', meta: { title: 'Ledger work', fields: ['dueYMD'] } }).includes('changed dueYMD'));
  check('delete: naam aur saath gayi copies',
    detailOf({ action: 'task.delete', meta: { title: 'Ledger work', owner: 'Naimish Saini', cascaded: 1 } })
      .includes('1 forwarded copy too'));
  check('status: SUBMITTED padha ja sake',
    detailOf({ action: 'task.status', meta: { title: 'X', status: 'SUBMITTED' } }).includes('submitted'));
  check('reject: wajah quote me',
    detailOf({ action: 'task.reject', meta: { title: 'X', reason: 'adhoora' } }).includes('“adhoora”'));
}

// ═══ 6 — credential jaisa kuch kabhi na chhape ═══
console.log('\n6 — password/token jaisi cheez kabhi na dikhe');
{
  for (const k of ['password', 'passwordHash', 'token', 'apiKey', 'otp', 'secret']) {
    const l = detailOf({ action: 'user.update', meta: { [k]: 'hunter2' } });
    check(`${k} nahi chhapa`, !l.includes('hunter2'), l || '(khaali)');
  }
}

// ═══ 7 — kinare ke case ═══
console.log('\n7 — kinare ke case');
{
  check('meta hi na ho', detailOf({ action: 'auth.login' }) === '');
  check('khaali meta', detailOf({ action: 'auth.login', meta: {} }) === '');
  check('action hi na ho to crash na ho', typeof detailOf({ meta: { amount: 4000 } }) === 'string');
  check('amount 0 par bhi kuch na toote', typeof detailOf({ action: 'dues.add', meta: { amount: 0 } }) === 'string');
  check('humanize theek', humanize('task.status') === 'task · status', humanize('task.status'));
}

console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PASS'}\n`);
process.exit(failures ? 1 : 0);
