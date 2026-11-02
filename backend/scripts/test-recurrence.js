/**
 * Recurrence ke date-arithmetic ka test. Koi DB nahi.
 *
 * Yahan galti ka matlab: announcement galat din nikle, ya kisi mahine chupchaap nikle
 * hi nahi. Isliye har kinara alag se check hai — 31 taareekh wale mahine, leap year,
 * saal ka badalna, sab.
 *
 * Run (backend folder se):  node scripts/test-recurrence.js
 */
import {
  matchesYMD, nextOccurrenceYMD, describeRule, isValidRule, normalizeRule,
  daysInMonth, weekdayOf, minutesOf, nextDay,
  weekdaysOf, monthDays, ruleDates, isRealYMD, dayLabel,
  RECURRENCE_TYPES, REPEATING_TYPES, MAX_RULE_DATES,
} from '../src/lib/recurrence.js';
// Ye do sirf isliye ki type ka naam PAANCH jagah likha hai aur paanchon barabar hone
// chahiye (section 17). Model import karne se koi connection nahi banta — ye file DB ke
// bina chalti hai aur chalti rahegi.
import { Announcement } from '../src/models/Announcement.js';
import { createAnnouncementSchema } from '../src/validators/announcements.validators.js';

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
  // JAAN-BOOJH KAR badla (2 Nov 2026). Pehle yahan `n.weekday === 6` tha. Ab normalizeRule
  // ek akela din uski LIST me migrate karta hai aur purana field null chhod deta hai —
  // likhne ka ek hi raasta, aur koi dusra reader yahan se purani shakal nahi uthata.
  const n = normalizeRule({ type: 'WEEKLY', weekday: 6, dayOfMonth: 15, month: 3 });
  check('WEEKLY me sirf weekdays bacha (weekday migrate hua)',
    n.weekdays.length === 1 && n.weekdays[0] === 6 && n.weekday === null && n.dayOfMonth === null && n.daysOfMonth.length === 0 && n.month === null,
    JSON.stringify(n));
  check('default time 09:00', n.time === '09:00');
  const m = normalizeRule({ type: 'MONTHLY', dayOfMonth: 31, weekday: 2, time: '18:30' });
  check('MONTHLY me sirf daysOfMonth (dayOfMonth migrate hua)',
    m.daysOfMonth.length === 1 && m.daysOfMonth[0] === 31 && m.dayOfMonth === null && m.weekday === null && m.weekdays.length === 0,
    JSON.stringify(m));
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

// ═══════════════════════════════════════════════════════════════════════════════
// Yahan se aage: KAI din ek hi rule me (owner, 2 Nov 2026)
// ═══════════════════════════════════════════════════════════════════════════════

// ═══ 10 — rule ki list padhna: nayi shakal, purani shakal, dono ═══
console.log('\n10 — list padhne wale helper (purani single-day rows bhi chalein)');
{
  check('weekdaysOf nayi shakal', JSON.stringify(weekdaysOf({ weekdays: [4, 1] })) === '[1,4]', JSON.stringify(weekdaysOf({ weekdays: [4, 1] })));
  check('weekdaysOf purani shakal', JSON.stringify(weekdaysOf({ weekday: 6 })) === '[6]');
  check('weekdaysOf khaali', JSON.stringify(weekdaysOf({})) === '[]');
  check('weekdaysOf weekday 0 (Sunday) ko null na samjhe', JSON.stringify(weekdaysOf({ weekday: 0 })) === '[0]');
  check('monthDays nayi shakal, sort + dedupe', JSON.stringify(monthDays({ daysOfMonth: [20, 1, 10, 10] })) === '[1,10,20]', JSON.stringify(monthDays({ daysOfMonth: [20, 1, 10, 10] })));
  check('monthDays purani shakal', JSON.stringify(monthDays({ dayOfMonth: 15 })) === '[15]');
  check('monthDays khaali list → purana field bhi khaali', JSON.stringify(monthDays({ daysOfMonth: [], dayOfMonth: null })) === '[]');
  check('monthDays undefined par crash nahi', JSON.stringify(monthDays(undefined)) === '[]');
  check('ruleDates sort + dedupe', JSON.stringify(ruleDates({ dates: ['2027-01-03', '2026-11-05', '2026-11-05'] })) === '["2026-11-05","2027-01-03"]');
  // Helper RUBBISH nahi chhanta — isValidRule ko use DEKH kar rule reject karna hota hai.
  check('helper kachra chhanta nahi (isValidRule ko dikhna chahiye)', JSON.stringify(monthDays({ daysOfMonth: [1.5, 10] })) === '[1.5,10]');
  check('…aur isliye aisa rule invalid hai', !isValidRule({ type: 'MONTHLY', daysOfMonth: [1.5, 10] }));
}

// ═══ 11 — WEEKLY: kai din ═══
console.log('\n11 — WEEKLY: har Somwar AUR Guruwar');
{
  const r = { type: 'WEEKLY', weekdays: [1, 4] };
  check('Mon 14 Sep match', matchesYMD(r, '2026-09-14') && weekdayOf('2026-09-14') === 1);
  check('Thu 17 Sep match', matchesYMD(r, '2026-09-17') && weekdayOf('2026-09-17') === 4);
  check('Tue 15 Sep nahi', !matchesYMD(r, '2026-09-15'));
  check('Sat 19 Sep nahi', !matchesYMD(r, '2026-09-19'));
  check('Tue se agla = Thu', nextOccurrenceYMD(r, '2026-09-15') === '2026-09-17', nextOccurrenceYMD(r, '2026-09-15'));
  check('Fri se agla = agla Mon', nextOccurrenceYMD(r, '2026-09-18') === '2026-09-21', nextOccurrenceYMD(r, '2026-09-18'));
  let count = 0;
  for (let cur = '2026-09-01'; cur < '2026-10-01'; cur = nextDay(cur)) if (matchesYMD(r, cur)) count += 1;
  check('Sep 2026 me 8 baar (4 Mon + 4 Thu; 1 Sep Mangal hai)', count === 8, `got ${count}`);
  check('saare 7 din = har din', [0, 1, 2, 3, 4, 5, 6].every((w) => matchesYMD({ type: 'WEEKLY', weekdays: [0, 1, 2, 3, 4, 5, 6] }, nextDay('2026-09-0' + (w + 1)))));
  check('khaali weekdays = invalid', !isValidRule({ type: 'WEEKLY', weekdays: [] }));
  check('weekday 7 = invalid', !isValidRule({ type: 'WEEKLY', weekdays: [7] }));
}

// ═══ 12 — MONTHLY: kai taareekhein + CLAMP ka asar ═══
console.log('\n12 — MONTHLY: 1, 10 aur 20 — aur clamp ke saath {28,31} / {30,31}');
{
  const r = { type: 'MONTHLY', daysOfMonth: [1, 10, 20] };
  check('1 Dec match', matchesYMD(r, '2026-12-01'));
  check('10 Dec match', matchesYMD(r, '2026-12-10'));
  check('20 Dec match', matchesYMD(r, '2026-12-20'));
  check('2 Dec nahi', !matchesYMD(r, '2026-12-02'));
  check('15 Dec nahi', !matchesYMD(r, '2026-12-15'));
  check('31 Dec nahi (koi pick 29+ nahi hai, to clamp ka sawaal hi nahi)', !matchesYMD(r, '2026-12-31'));
  check('2 Dec se agla = 10 Dec', nextOccurrenceYMD(r, '2026-12-02') === '2026-12-10');
  check('21 Dec se agla = 1 Jan', nextOccurrenceYMD(r, '2026-12-21') === '2027-01-01', nextOccurrenceYMD(r, '2026-12-21'));
  let count = 0;
  for (let cur = '2027-01-01'; cur < '2028-01-01'; cur = nextDay(cur)) if (matchesYMD(r, cur)) count += 1;
  check('2027 me theek 36 baar (12 × 3)', count === 36, `got ${count}`);

  // COLLAPSE: do pick ek hi din par gir sakte hain — ye SAHI hai, aur dialog save se
  // pehle hi bata deta hai. 28 ka pick majboori hai: min(a,dim)===min(b,dim) ke liye
  // dim===a chahiye aur dim hamesha >= 28 hota hai.
  const c = { type: 'MONTHLY', daysOfMonth: [28, 31] };
  check('{28,31} Feb 2027: sirf 28 (dono wahin gire)', matchesYMD(c, '2027-02-28') && !matchesYMD(c, '2027-02-27'));
  let feb = 0;
  for (let cur = '2027-02-01'; cur < '2027-03-01'; cur = nextDay(cur)) if (matchesYMD(c, cur)) feb += 1;
  check('…yaani Feb 2027 me EK outing, do nahi', feb === 1, `got ${feb}`);
  check('{28,31} Mar me DO (28 aur 31)', matchesYMD(c, '2027-03-28') && matchesYMD(c, '2027-03-31'));
  check('{28,31} Apr me DO (28 aur 30)', matchesYMD(c, '2027-04-28') && matchesYMD(c, '2027-04-30'));
  check('{28,31} leap Feb 2028 me DO aur LAGATAR (28, 29)', matchesYMD(c, '2028-02-28') && matchesYMD(c, '2028-02-29'));

  // {30,31}: paanch mahine me 31 ka pick no-op hai — mahine-waar ginti.
  const t = { type: 'MONTHLY', daysOfMonth: [30, 31] };
  const perMonth = [];
  for (let m = 1; m <= 12; m += 1) {
    let k = 0;
    const mm = String(m).padStart(2, '0');
    for (let cur = `2027-${mm}-01`; cur.slice(5, 7) === mm; cur = nextDay(cur)) if (matchesYMD(t, cur)) k += 1;
    perMonth.push(k);
  }
  // Paanch mahine (Feb, Apr, Jun, Sep, Nov) me 31 ka pick no-op hai — dono 30 par girte hain.
  check('{30,31} 2027 mahine-waar = [2,1,2,1,2,1,2,2,1,2,1,2]',
    JSON.stringify(perMonth) === '[2,1,2,1,2,1,2,2,1,2,1,2]', JSON.stringify(perMonth));
  check('…yaani paanch mahine me 31 ka pick bekaar', perMonth.filter((k) => k === 1).length === 5);

  check('{1,31} Feb-March ke mod par LAGATAR hai', matchesYMD({ type: 'MONTHLY', daysOfMonth: [1, 31] }, '2027-02-28') && matchesYMD({ type: 'MONTHLY', daysOfMonth: [1, 31] }, '2027-03-01'));
  check('khaali daysOfMonth = invalid', !isValidRule({ type: 'MONTHLY', daysOfMonth: [] }));
  check('daysOfMonth [0] = invalid', !isValidRule({ type: 'MONTHLY', daysOfMonth: [0] }));
  check('daysOfMonth [32] = invalid', !isValidRule({ type: 'MONTHLY', daysOfMonth: [32] }));
  check("daysOfMonth ['3'] = invalid", !isValidRule({ type: 'MONTHLY', daysOfMonth: ['3'] }));
  check('saari 31 = valid', isValidRule({ type: 'MONTHLY', daysOfMonth: Array.from({ length: 31 }, (_, i) => i + 1) }));
}

// ═══ 13 — YEARLY: ek mahine me kai taareekhein ═══
console.log('\n13 — YEARLY: har saal August ki 1, 15 aur 31');
{
  const r = { type: 'YEARLY', month: 8, daysOfMonth: [1, 15, 31] };
  check('1 Aug match', matchesYMD(r, '2026-08-01'));
  check('15 Aug match', matchesYMD(r, '2026-08-15'));
  check('31 Aug match', matchesYMD(r, '2026-08-31'));
  check('15 Sep nahi (galat mahina)', !matchesYMD(r, '2026-09-15'));
  check('2 Aug nahi', !matchesYMD(r, '2026-08-02'));
  check('2 Aug se agla = 15 Aug', nextOccurrenceYMD(r, '2026-08-02') === '2026-08-15');
  check('1 Sep se agla = 1 Aug 2027', nextOccurrenceYMD(r, '2026-09-01') === '2027-08-01', nextOccurrenceYMD(r, '2026-09-01'));
  check('YEARLY bina koi din = invalid', !isValidRule({ type: 'YEARLY', month: 8, daysOfMonth: [] }));
  check('YEARLY bina month = invalid', !isValidRule({ type: 'YEARLY', daysOfMonth: [1] }));
  // Feb me clamp YEARLY par bhi chalta hai — purana 29-Feb wala niyam list ke saath bhi.
  const f = { type: 'YEARLY', month: 2, daysOfMonth: [14, 29] };
  check('{14,29} Feb 2027 (non-leap): 14 aur 28', matchesYMD(f, '2027-02-14') && matchesYMD(f, '2027-02-28'));
  check('{14,29} Feb 2028 (leap): 14 aur 29', matchesYMD(f, '2028-02-14') && matchesYMD(f, '2028-02-29') && !matchesYMD(f, '2028-02-28'));
}

// ═══ 14 — DATES: sirf wahi din jo chune gaye ═══
console.log('\n14 — DATES: gini-chuni calendar taareekhein, koi clamp nahi');
{
  const r = { type: 'DATES', dates: ['2026-11-05', '2026-12-12', '2027-01-03'] };
  check('5 Nov match', matchesYMD(r, '2026-11-05'));
  check('4 Nov nahi', !matchesYMD(r, '2026-11-04'));
  check('6 Nov nahi', !matchesYMD(r, '2026-11-06'));
  check('3 Jan 2027 match', matchesYMD(r, '2027-01-03'));
  check('2 Nov se agla = 5 Nov', nextOccurrenceYMD(r, '2026-11-02') === '2026-11-05');
  check('5 Nov se agla = wahi din (inclusive)', nextOccurrenceYMD(r, '2026-11-05') === '2026-11-05');
  check('6 Nov se agla = 12 Dec', nextOccurrenceYMD(r, '2026-11-06') === '2026-12-12');
  check('4 Jan 2027 se agla = null (sab nikal gayi)', nextOccurrenceYMD(r, '2027-01-04') === null);
  // KOI CLAMP NAHI — 28 Feb wali date March me roll na ho.
  check('{28 Feb} March me roll NAHI hoti', !matchesYMD({ type: 'DATES', dates: ['2026-02-28'] }, '2026-03-01'));
  // 366-din ka walk bypass: do saal door ki date "kabhi nahi" na bane.
  check('366 din ke paar wali date milti hai',
    nextOccurrenceYMD({ type: 'DATES', dates: ['2026-11-05', '2029-01-03'] }, '2026-11-06') === '2029-01-03',
    nextOccurrenceYMD({ type: 'DATES', dates: ['2026-11-05', '2029-01-03'] }, '2026-11-06'));
  // Bina sort kiye `.find()` ARRAY ke kram ka pehla >= deta hai — galat (baad ka) din
  // publishAt AUR claim stamp dono me chala jaata hai, aur usse pehli saari dates mar
  // jaati hain. Isliye sort defensive hai, cosmetic nahi.
  check('unsorted list par bhi SABSE PEHLA din',
    nextOccurrenceYMD({ type: 'DATES', dates: ['2029-01-03', '2026-11-05', '2026-12-12'] }, '2026-11-02') === '2026-11-05',
    nextOccurrenceYMD({ type: 'DATES', dates: ['2029-01-03', '2026-11-05', '2026-12-12'] }, '2026-11-02'));
  check('khaali dates = invalid', !isValidRule({ type: 'DATES', dates: [] }));
  check('bina dates = invalid', !isValidRule({ type: 'DATES' }));
  // Sirf regex kaafi nahi: '2027-02-31' shakal se theek hai par calendar me nahi, aur
  // matchesYMD use kabhi true nahi dega — post chupchaap kabhi nahi nikalti.
  check("'2027-02-31' = invalid (shakal theek, din nahi)", !isValidRule({ type: 'DATES', dates: ['2027-02-31'] }));
  check("'2026-13-99' = invalid", !isValidRule({ type: 'DATES', dates: ['2026-13-99'] }));
  check("'0001-01-01' = invalid (saal ki seema)", !isValidRule({ type: 'DATES', dates: ['0001-01-01'] }));
  check('isRealYMD: 29 Feb 2028 asli, 2027 nahi', isRealYMD('2028-02-29') && !isRealYMD('2027-02-29'));
  check(`${MAX_RULE_DATES} dates = valid`, isValidRule({ type: 'DATES', dates: Array.from({ length: MAX_RULE_DATES }, (_, i) => `2027-01-${String(i + 1).padStart(2, '0')}`) }));
  check(`${MAX_RULE_DATES + 1} dates = invalid (cap engine me bhi, sirf zod me nahi)`,
    !isValidRule({ type: 'DATES', dates: Array.from({ length: MAX_RULE_DATES + 1 }, (_, i) => `2027-01-${String(i + 1).padStart(2, '0')}`) }));
  check('duplicate date par ek hi din', JSON.stringify(ruleDates({ dates: ['2026-11-05', '2026-11-05'] })) === '["2026-11-05"]');
}

// ═══ 15 — describeRule: ek din par SHABD BYTE-IDENTICAL rahein ═══
console.log('\n15 — describeRule list ke saath (ek din par purana vaakya na badle)');
{
  // Ye sirf dikhne ki baat nahi: controller ise AuditLog me likhta hai aur khaali string
  // ko "repeat band kar diya" padhta hai.
  check('WEEKLY ek din — purane jaisa hi', describeRule({ type: 'WEEKLY', weekdays: [6], time: '09:00' }) === 'Every Saturday at 09:00', describeRule({ type: 'WEEKLY', weekdays: [6], time: '09:00' }));
  check('WEEKLY do din', describeRule({ type: 'WEEKLY', weekdays: [1, 4], time: '09:00' }) === 'Every Monday and Thursday at 09:00', describeRule({ type: 'WEEKLY', weekdays: [1, 4], time: '09:00' }));
  check('MONTHLY ek din — purane jaisa hi', describeRule({ type: 'MONTHLY', daysOfMonth: [12], time: '09:00' }) === 'Every month on the 12th at 09:00', describeRule({ type: 'MONTHLY', daysOfMonth: [12], time: '09:00' }));
  check('MONTHLY teen din', describeRule({ type: 'MONTHLY', daysOfMonth: [1, 10, 20], time: '09:00' }) === 'Every month on the 1st, 10th and 20th at 09:00', describeRule({ type: 'MONTHLY', daysOfMonth: [1, 10, 20], time: '09:00' }));
  check('MONTHLY kram list ke kram se nahi, din ke kram se', describeRule({ type: 'MONTHLY', daysOfMonth: [20, 1, 10], time: '09:00' }) === 'Every month on the 1st, 10th and 20th at 09:00');
  check('YEARLY ek din — purane jaisa hi', describeRule({ type: 'YEARLY', month: 8, daysOfMonth: [15], time: '10:00' }) === 'Every year on 15 August at 10:00', describeRule({ type: 'YEARLY', month: 8, daysOfMonth: [15], time: '10:00' }));
  check('YEARLY do din', describeRule({ type: 'YEARLY', month: 8, daysOfMonth: [15, 31], time: '10:00' }) === 'Every year on 15 and 31 August at 10:00', describeRule({ type: 'YEARLY', month: 8, daysOfMonth: [15, 31], time: '10:00' }));
  check('DATES ek din', describeRule({ type: 'DATES', dates: ['2026-11-05'], time: '09:00' }) === 'On 5 Nov 2026 at 09:00', describeRule({ type: 'DATES', dates: ['2026-11-05'], time: '09:00' }));
  check('DATES teen din', describeRule({ type: 'DATES', dates: ['2026-11-05', '2026-12-12', '2027-01-03'], time: '09:00' }) === 'On 5 Nov 2026, 12 Dec 2026 and 3 Jan 2027 at 09:00', describeRule({ type: 'DATES', dates: ['2026-11-05', '2026-12-12', '2027-01-03'], time: '09:00' }));
  // Teen se zyada par list vaakya nahi rehti — chip phone par toot jaati hai.
  check('DATES chaar+ din = chhota roop',
    describeRule({ type: 'DATES', dates: ['2026-11-05', '2026-12-12', '2027-01-03', '2027-02-09'], time: '09:00' }) === 'On 4 dates between 5 Nov 2026 and 9 Feb 2027 at 09:00',
    describeRule({ type: 'DATES', dates: ['2026-11-05', '2026-12-12', '2027-01-03', '2027-02-09'], time: '09:00' }));
  check('har valid rule kuch kehta hai (khaali = audit log me jhooth)',
    [{ type: 'WEEKLY', weekdays: [0] }, { type: 'MONTHLY', daysOfMonth: [1] }, { type: 'YEARLY', month: 1, daysOfMonth: [1] }, { type: 'DATES', dates: ['2027-01-01'] }].every((r) => describeRule(r) !== ''));
  check('dayLabel', dayLabel('2026-11-05') === '5 Nov 2026', dayLabel('2026-11-05'));
}

// ═══ 16 — normalizeRule: list ki safai aur POORI shakal ═══
console.log('\n16 — normalizeRule: dedupe, sort, kachra hatao, shakal hamesha poori');
{
  const m = normalizeRule({ type: 'MONTHLY', daysOfMonth: [5, 5, 0, 32, 10.9, 10], dayOfMonth: 7, time: '09:00' });
  check('MONTHLY: kachra chhanta, dedupe, sort', JSON.stringify(m.daysOfMonth) === '[5,10]', JSON.stringify(m.daysOfMonth));
  check('MONTHLY: purana dayOfMonth null (migrate-on-write)', m.dayOfMonth === null);
  const w = normalizeRule({ type: 'WEEKLY', weekdays: [4, 1, 1, 9], time: '09:00' });
  check('WEEKLY: dedupe + sort + seema', JSON.stringify(w.weekdays) === '[1,4]', JSON.stringify(w.weekdays));
  const d = normalizeRule({ type: 'DATES', dates: ['2026-12-12', '2026-11-05', '2026-11-05', '2026-02-31'], time: '09:00' });
  check('DATES: dedupe + sort + jhoothi date hatti', JSON.stringify(d.dates) === '["2026-11-05","2026-12-12"]', JSON.stringify(d.dates));
  const capped = normalizeRule({ type: 'DATES', dates: Array.from({ length: MAX_RULE_DATES + 5 }, (_, i) => `2027-01-${String(i + 1).padStart(2, '0')}`) });
  check(`DATES: cap ${MAX_RULE_DATES} par, aur SORT ke baad kata`, capped.dates.length === MAX_RULE_DATES && capped.dates[0] === '2027-01-01');
  // Mongoose nested sub-object assign karne par default DOBARA nahi lagata — ek key chhodi
  // to row par undefined, JSON se gayab, aur dialog ka JSON-diff har save par
  // "recurrence changed" bolne lagta hai.
  check('har type par TEENO list key maujood (chahe khaali)',
    ['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY', 'DATES'].every((t) => {
      const o = normalizeRule({ type: t, weekday: 1, dayOfMonth: 1, month: 1, dates: ['2027-01-01'] });
      return Array.isArray(o.weekdays) && Array.isArray(o.daysOfMonth) && Array.isArray(o.dates);
    }));
  check('type badalne par purani list zero ho jaati hai',
    JSON.stringify(normalizeRule({ type: 'WEEKLY', weekday: 6, dates: ['2026-11-05'], daysOfMonth: [5] }).dates) === '[]');
  check('DATES par weekdays/daysOfMonth khaali',
    normalizeRule({ type: 'DATES', dates: ['2027-01-01'], weekday: 3, dayOfMonth: 9 }).weekdays.length === 0
    && normalizeRule({ type: 'DATES', dates: ['2027-01-01'], weekday: 3, dayOfMonth: 9 }).daysOfMonth.length === 0);
}

// ═══ 17 — type ka naam PAANCH jagah likha hai: sab barabar hon ═══
console.log('\n17 — type ki list paanch jagah: engine, model, validator — sab ek');
{
  check('model ka enum = RECURRENCE_TYPES',
    JSON.stringify(Announcement.schema.path('recurrence.type').enumValues) === JSON.stringify(RECURRENCE_TYPES),
    JSON.stringify(Announcement.schema.path('recurrence.type').enumValues));
  check('REPEATING_TYPES = RECURRENCE_TYPES minus NONE',
    JSON.stringify(REPEATING_TYPES) === JSON.stringify(RECURRENCE_TYPES.filter((t) => t !== 'NONE')));
  // Model me array path bhoolna is poore chain ka SABSE CHUP bug hai: strict mode value ko
  // bina error girata hai, explicit .set() par bhi — post bas kabhi nikalta nahi.
  check('model me teeno list path asli schema path hain',
    ['recurrence.weekdays', 'recurrence.daysOfMonth', 'recurrence.dates'].every((p) => !!Announcement.schema.path(p)),
    ['recurrence.weekdays', 'recurrence.daysOfMonth', 'recurrence.dates'].filter((p) => !Announcement.schema.path(p)).join(', ') || 'sab hain');

  // Validator ko behaviour se jaancha, introspection se nahi — key declare karna bhool
  // jaane par zod use CHUPCHAAP strip kar deta hai aur request phir bhi 201 deti hai.
  const ok = (rec) => createAnnouncementSchema.safeParse({ title: 'x', recurrence: rec });
  const a = ok({ type: 'DATES', dates: ['2027-01-05'], time: '09:00' });
  check('validator: DATES chalta hai', a.success, a.success ? '' : JSON.stringify(a.error.flatten().fieldErrors));
  check('validator: DATES ki dates nigli nahi gayi', a.success && a.data.recurrence.dates.length === 1);
  const b = ok({ type: 'MONTHLY', daysOfMonth: [1, 10, 20], time: '09:00' });
  check('validator: MONTHLY ki list chalti hai', b.success && b.data.recurrence.daysOfMonth.length === 3, b.success ? '' : JSON.stringify(b.error.flatten().fieldErrors));
  const c = ok({ type: 'WEEKLY', weekdays: [1, 4], time: '09:00' });
  check('validator: WEEKLY ki list chalti hai', c.success && c.data.recurrence.weekdays.length === 2);
  check('validator: purani single-day shakal ab bhi chalti hai (cached app)', ok({ type: 'MONTHLY', dayOfMonth: 5, time: '09:00' }).success && ok({ type: 'WEEKLY', weekday: 6, time: '09:00' }).success);
  // Khaali list par LENGTH se check hona chahiye — `=== undefined` likha ho to khaali
  // array nikal jaata hai aur date-arithmetic ko koi din nahi milta (RangeError → 500).
  check('validator: khaali list reject (undefined nahi, LENGTH par check)',
    !ok({ type: 'MONTHLY', daysOfMonth: [] }).success && !ok({ type: 'WEEKLY', weekdays: [] }).success && !ok({ type: 'DATES', dates: [] }).success);
  check('validator: jhoothi date reject', !ok({ type: 'DATES', dates: ['2027-02-31'] }).success);
  check(`validator: ${MAX_RULE_DATES} se zyada dates reject (bina .max() 2000 bhi pass ho jaata)`,
    !ok({ type: 'DATES', dates: Array.from({ length: MAX_RULE_DATES + 1 }, (_, i) => `2027-01-${String(i + 1).padStart(2, '0')}`) }).success);
  check('validator: YEARLY bina month reject', !ok({ type: 'YEARLY', daysOfMonth: [1] }).success);
}

console.log(`\n${failures ? `❌ ${failures} FAIL` : '✅ SAB PASS'}\n`);
process.exit(failures ? 1 : 0);
