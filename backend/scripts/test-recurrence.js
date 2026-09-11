/**
 * Recurrence ke date-arithmetic ka test. Koi DB nahi.
 *
 * Yahan galti ka matlab: announcement galat din nikle, ya kisi mahine chupchaap nikle
 * hi nahi. Isliye har kinara alag se check hai — 31 taareekh wale mahine, leap year,
 * saal ka badalna, sab.
 *
 * Run (backend folder se):  node scripts/test-recurrence.js
 */
import { matchesYMD, nextOccurrenceYMD, describeRule, isValidRule, normalizeRule, daysInMonth, weekdayOf, minutesOf, nextDay } from '../src/lib/recurrence.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`);
  if (!cond) failures += 1;
}

console.log('\n🧪 recurrence — kaunsa din, kaunsa nahi\n');

// ═══ 1 — har shanivaar ═══
console.log('1 — WEEKLY: har Saturday');
{
  const r = { type: 'WEEKLY', weekday: 6 };
  check('12 Sep 2026 Saturday hai', weekdayOf('2026-09-12') === 6);
  check('Saturday par match', matchesYMD(r, '2026-09-12'));
  check('Friday par nahi', !matchesYMD(r, '2026-09-11'));
  check('Sunday par nahi', !matchesYMD(r, '2026-09-13'));
  check('Friday se agla = Saturday', nextOccurrenceYMD(r, '2026-09-11') === '2026-09-12', nextOccurrenceYMD(r, '2026-09-11'));
  check('Saturday se agla = wahi din (inclusive)', nextOccurrenceYMD(r, '2026-09-12') === '2026-09-12');
  check('Sunday se agla = agle hafte ka Saturday', nextOccurrenceYMD(r, '2026-09-13') === '2026-09-19', nextOccurrenceYMD(r, '2026-09-13'));
  check('saal ke paar bhi sahi (31 Dec 2026 → 2 Jan 2027)', nextOccurrenceYMD(r, '2026-12-31') === '2027-01-02', nextOccurrenceYMD(r, '2026-12-31'));
}

// ═══ 2 — mahine ki ek taareekh ═══
console.log('\n2 — MONTHLY: har mahine ki 15 ko');
{
  const r = { type: 'MONTHLY', dayOfMonth: 15 };
  check('15 Sep match', matchesYMD(r, '2026-09-15'));
  check('14 Sep nahi', !matchesYMD(r, '2026-09-14'));
  check('16 Sep nahi', !matchesYMD(r, '2026-09-16'));
  check('16 Sep se agla = 15 Oct', nextOccurrenceYMD(r, '2026-09-16') === '2026-10-15', nextOccurrenceYMD(r, '2026-09-16'));
  check('Dec se agla saal', nextOccurrenceYMD(r, '2026-12-16') === '2027-01-15', nextOccurrenceYMD(r, '2026-12-16'));
}

// ═══ 3 — THE CLAMP: 31 taareekh chhote mahine me ═══
console.log('\n3 — MONTHLY 31: chhote mahine me aakhri din par nikle, skip na ho');
{
  const r = { type: 'MONTHLY', dayOfMonth: 31 };
  check('31 Jan match', matchesYMD(r, '2026-01-31'));
  check('28 Feb 2026 match (Feb me 28 hi hain)', matchesYMD(r, '2026-02-28'));
  check('27 Feb nahi', !matchesYMD(r, '2026-02-27'));
  check('30 Apr match (April me 30)', matchesYMD(r, '2026-04-30'));
  check('29 Apr nahi', !matchesYMD(r, '2026-04-29'));
  check('31 May match', matchesYMD(r, '2026-05-31'));
  check('30 May nahi (May me 31 hain)', !matchesYMD(r, '2026-05-30'));
  check('1 Feb se agla = 28 Feb, March nahi', nextOccurrenceYMD(r, '2026-02-01') === '2026-02-28', nextOccurrenceYMD(r, '2026-02-01'));
  // Poore saal me 12 baar hi nikle — na kam, na zyada
  let count = 0;
  for (let cur = '2026-01-01'; cur < '2027-01-01'; cur = nextDay(cur)) if (matchesYMD(r, cur)) count += 1;
  check('2026 me theek 12 baar', count === 12, `got ${count}`);
}

// ═══ 4 — saal me ek din ═══
console.log('\n4 — YEARLY: har saal 26 January');
{
  const r = { type: 'YEARLY', month: 1, dayOfMonth: 26 };
  check('26 Jan 2026 match', matchesYMD(r, '2026-01-26'));
  check('26 Feb nahi (galat mahina)', !matchesYMD(r, '2026-02-26'));
  check('25 Jan nahi', !matchesYMD(r, '2026-01-25'));
  check('27 Jan 2026 se agla = 26 Jan 2027', nextOccurrenceYMD(r, '2026-01-27') === '2027-01-26', nextOccurrenceYMD(r, '2026-01-27'));
  check('26 Jan se agla = wahi din', nextOccurrenceYMD(r, '2026-01-26') === '2026-01-26');
}

// ═══ 5 — leap year: 29 Feb ═══
console.log('\n5 — YEARLY 29 Feb: non-leap saal me 28 Feb par nikle');
{
  const r = { type: 'YEARLY', month: 2, dayOfMonth: 29 };
  check('2028 leap hai → 29 Feb match', matchesYMD(r, '2028-02-29'));
  check('2028 me 28 Feb nahi', !matchesYMD(r, '2028-02-28'));
  check('2027 non-leap → 28 Feb match', matchesYMD(r, '2027-02-28'));
  check('2027 me 1 March nahi', !matchesYMD(r, '2027-03-01'));
  check('1 Jan 2027 se agla = 28 Feb 2027', nextOccurrenceYMD(r, '2027-01-01') === '2027-02-28', nextOccurrenceYMD(r, '2027-01-01'));
  check('1 Jan 2028 se agla = 29 Feb 2028', nextOccurrenceYMD(r, '2028-01-01') === '2028-02-29', nextOccurrenceYMD(r, '2028-01-01'));
  check('daysInMonth(2028,2) = 29', daysInMonth(2028, 2) === 29);
  check('daysInMonth(2100,2) = 28 (100 se bhaajya, 400 se nahi)', daysInMonth(2100, 2) === 28);
}

// ═══ 6 — NONE aur galat rules ═══
console.log('\n6 — NONE aur adhoore rules');
{
  check('NONE kabhi match na kare', !matchesYMD({ type: 'NONE' }, '2026-09-12'));
  check('NONE ka agla = null', nextOccurrenceYMD({ type: 'NONE' }, '2026-09-12') === null);
  check('WEEKLY bina weekday = invalid', !isValidRule({ type: 'WEEKLY' }));
  check('MONTHLY dayOfMonth 0 = invalid', !isValidRule({ type: 'MONTHLY', dayOfMonth: 0 }));
  check('MONTHLY dayOfMonth 32 = invalid', !isValidRule({ type: 'MONTHLY', dayOfMonth: 32 }));
  check('YEARLY month 13 = invalid', !isValidRule({ type: 'YEARLY', month: 13, dayOfMonth: 1 }));
  check('YEARLY bina month = invalid', !isValidRule({ type: 'YEARLY', dayOfMonth: 1 }));
  check('galat time = invalid', !isValidRule({ type: 'WEEKLY', weekday: 1, time: '25:00' }));
  check('sahi time = valid', isValidRule({ type: 'WEEKLY', weekday: 1, time: '09:30' }));
  check('anjaan type = invalid', !isValidRule({ type: 'DAILY' }));
  check('null rule = invalid, crash nahi', !isValidRule(null));
  check('galat date par match false, crash nahi', !matchesYMD({ type: 'WEEKLY', weekday: 6 }, 'kal'));
  check('invalid rule ka agla = null', nextOccurrenceYMD({ type: 'WEEKLY' }, '2026-09-12') === null);
}

// ═══ 7 — padhne layak description ═══
console.log('\n7 — describeRule');
{
  check('weekly', describeRule({ type: 'WEEKLY', weekday: 6, time: '09:00' }) === 'Every Saturday at 09:00', describeRule({ type: 'WEEKLY', weekday: 6, time: '09:00' }));
  check('monthly 1st', describeRule({ type: 'MONTHLY', dayOfMonth: 1 }) === 'Every month on the 1st', describeRule({ type: 'MONTHLY', dayOfMonth: 1 }));
  check('monthly 22nd', describeRule({ type: 'MONTHLY', dayOfMonth: 22 }) === 'Every month on the 22nd');
  check('monthly 13th (11-13 = th)', describeRule({ type: 'MONTHLY', dayOfMonth: 13 }) === 'Every month on the 13th');
  check('yearly', describeRule({ type: 'YEARLY', month: 8, dayOfMonth: 15, time: '10:00' }) === 'Every year on 15 August at 10:00', describeRule({ type: 'YEARLY', month: 8, dayOfMonth: 15, time: '10:00' }));
  check('NONE = khaali', describeRule({ type: 'NONE' }) === '');
}

// ═══ 8 — normalizeRule: purane field na bachein ═══
console.log('\n8 — normalizeRule: type badalne par purane fields saaf');
{
  const n = normalizeRule({ type: 'WEEKLY', weekday: 6, dayOfMonth: 15, month: 3 });
  check('WEEKLY me sirf weekday bacha', n.weekday === 6 && n.dayOfMonth === null && n.month === null, JSON.stringify(n));
  check('default time 09:00', n.time === '09:00');
  const m = normalizeRule({ type: 'MONTHLY', dayOfMonth: 31, weekday: 2, time: '18:30' });
  check('MONTHLY me sirf dayOfMonth', m.dayOfMonth === 31 && m.weekday === null, JSON.stringify(m));
  check('time rakha', m.time === '18:30');
  check('kachra type → NONE', normalizeRule({ type: 'HOURLY' }).type === 'NONE');
  check('undefined → NONE, crash nahi', normalizeRule(undefined).type === 'NONE');
  check('galat time → default', normalizeRule({ type: 'WEEKLY', weekday: 1, time: 'abc' }).time === '09:00');
}

// ═══ 9 — minutesOf ═══
console.log('\n9 — minutesOf');
{
  check('09:00 = 540', minutesOf('09:00') === 540);
  check('18:30 = 1110', minutesOf('18:30') === 1110);
  check('00:00 = 0', minutesOf('00:00') === 0);
  check('galat = 0', minutesOf('x') === 0);
}

console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PASS'}\n`);
process.exit(failures ? 1 : 0);
