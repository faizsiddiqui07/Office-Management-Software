/**
 * lib/note-editing.js — note likhne wale box ka andar ka ganit.
 *
 * Yahan cursor ki jagah utni hi zaroori hai jitna matn: bold dabane ke baad agar cursor
 * galat jagah chala jaaye to banda nishaan ke BAHAR likhne lagta hai aur kuch bold hota
 * hi nahi. Isliye har check matn aur cursor DONO dekhta hai.
 *
 * Likhawat: "ab|cd" me | cursor hai, "ab[cd]ef" me cd chuna hua hai.
 *
 * Run (website folder se):  node scripts/test-note-editing.mjs
 */
import { toggleWrap, toggleList, enterInList } from '../lib/note-editing.js';

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log('  ✅ ' + label); } else { fail += 1; console.log('  ❌ ' + label + '  — ' + extra); }
};

/** "ab[cd]ef" / "ab|cd" → { value, start, end } */
function read(s) {
  if (s.includes('|')) { const i = s.indexOf('|'); const v = s.replace('|', ''); return { value: v, start: i, end: i }; }
  const a = s.indexOf('[');
  const b = s.indexOf(']');
  const value = s.slice(0, a) + s.slice(a + 1, b) + s.slice(b + 1);
  return { value, start: a, end: b - 1 };
}
/** Ulta — nateeje ko padhne layak banane ke liye. */
function show(r) {
  if (r == null) return '(null)';
  const { value, start, end } = r;
  return start === end
    ? value.slice(0, start) + '|' + value.slice(start)
    : value.slice(0, start) + '[' + value.slice(start, end) + ']' + value.slice(end);
}
const run = (fn, s, ...rest) => { const r = read(s); return show(fn(r.value, r.start, r.end, ...rest)); };

console.log('1) Bold — kuch chuna hua ho');
ok(run(toggleWrap, 'ye [zaroori] hai', '**') === 'ye **[zaroori]** hai', 'chune hue ko lapeta, wahi chuna raha', run(toggleWrap, 'ye [zaroori] hai', '**'));
ok(run(toggleWrap, '[a]', '**') === '**[a]**', 'poora matn');
ok(run(toggleWrap, 'ye **[zaroori]** hai', '**') === 'ye [zaroori] hai', 'dobara dabane par nishaan hat gaye (nishaan bahar the)', run(toggleWrap, 'ye **[zaroori]** hai', '**'));
ok(run(toggleWrap, 'ye [**zaroori**] hai', '**') === 'ye [zaroori] hai', 'nishaan selection ke ANDAR the tab bhi hate', run(toggleWrap, 'ye [**zaroori**] hai', '**'));

console.log('2) Bold — kuch chuna hi na ho (cursor beech me aana chahiye)');
ok(run(toggleWrap, 'ab|cd', '**') === 'ab**|**cd', 'nishaan daale, cursor unke BEECH', run(toggleWrap, 'ab|cd', '**'));
ok(run(toggleWrap, '|', '**') === '**|**', 'khaali box me bhi');

console.log('3) Italic aur kaata hua — wahi niyam, alag nishaan');
ok(run(toggleWrap, '[x]', '*') === '*[x]*', 'italic');
ok(run(toggleWrap, '*[x]*', '*') === '[x]', 'italic wapas');
ok(run(toggleWrap, '[x]', '~~') === '~~[x]~~', 'kaata hua');
ok(run(toggleWrap, '`[x]`', '`') === '[x]', 'code wapas');

console.log('4) Bullet list');
ok(run(toggleList, '|ek', 'ul') === '- ek|', 'ek line bullet bani, cursor ANT me (chuni hui nahi)', run(toggleList, '|ek', 'ul'));
ok(run(toggleList, '[ek\ndo]', 'ul') === '[- ek\n- do]', 'dono line bullet', run(toggleList, '[ek\ndo]', 'ul'));
ok(run(toggleList, '[- ek\n- do]', 'ul') === '[ek\ndo]', 'dobara dabane par bullet hate', run(toggleList, '[- ek\n- do]', 'ul'));
ok(run(toggleList, 'e|k', 'ul') === '- ek|', 'cursor line ke beech me ho tab bhi poori line, aur cursor ant me', run(toggleList, 'e|k', 'ul'));

console.log('4b) BUG (owner, 31 Oct): naya "1. " CHUNA hua nahi rehna chahiye');
{
  // Khaali box me "Numbered list" dabao. Pehle "1. " khud highlight reh jaata tha, aur
  // agla akshar use mita deta tha — banda jo likhta, ginti gayab.
  const r = toggleList('', 0, 0, 'ol');
  ok(r.value === '1. ', 'khaali box → "1. " aaya', JSON.stringify(r.value));
  ok(r.start === r.end, 'kuch CHUNA hua nahi (yahi bug tha)', `start=${r.start} end=${r.end}`);
  ok(r.start === 3, 'cursor "1. " ke theek baad, seedha likhna shuru', String(r.start));

  // Aur ab likhne par ginti bachni chahiye.
  const typed = r.value.slice(0, r.start) + 'drawing lena' + r.value.slice(r.end);
  ok(typed === '1. drawing lena', 'likhne par "1. " bacha raha', JSON.stringify(typed));

  // Bullet par bhi wahi.
  const b = toggleList('', 0, 0, 'ul');
  ok(b.value === '- ' && b.start === b.end && b.start === 2, 'bullet par bhi cursor ant me, kuch chuna nahi',
    JSON.stringify(b));

  // Dobara dabane par wapas saada — cursor ant me hone ke baad bhi.
  const off = toggleList(r.value, r.start, r.end, 'ol');
  ok(off.value === '', 'dobara dabaya → ginti hat gayi', JSON.stringify(off.value));
}

console.log('4c) kai line chuni ho to chuni hi rahein (poora block wapas ho sake)');
{
  const r = toggleList('ek\ndo', 0, 5, 'ol');
  ok(r.value === '1. ek\n2. do', 'dono line ginti me', JSON.stringify(r.value));
  ok(r.start !== r.end, 'block chuna hua hai', `start=${r.start} end=${r.end}`);
  const off = toggleList(r.value, r.start, r.end, 'ol');
  ok(off.value === 'ek\ndo', 'dobara dabane par POORA block wapas saada', JSON.stringify(off.value));
}

console.log('5) Ginti wali list');
ok(run(toggleList, '[ek\ndo\nteen]', 'ol') === '[1. ek\n2. do\n3. teen]', '1, 2, 3', run(toggleList, '[ek\ndo\nteen]', 'ol'));
ok(run(toggleList, '[1. ek\n2. do]', 'ol') === '[ek\ndo]', 'dobara dabane par ginti hat gayi');
ok(run(toggleList, '[- ek\n- do]', 'ol') === '[1. ek\n2. do]', 'bullet se ginti par', run(toggleList, '[- ek\n- do]', 'ol'));
ok(run(toggleList, '[1. ek\n2. do]', 'ul') === '[- ek\n- do]', 'ginti se bullet par');

console.log('6) Enter dabane par list aage badhe (owner ki asli maang)');
ok(show(enterInList(...Object.values(read('1. pehla kaam|')).slice(0, 1).concat([read('1. pehla kaam|').start, read('1. pehla kaam|').end])))
  === '1. pehla kaam\n2. |', '"1. pehla kaam" + Enter → "2. "',
  show(enterInList('1. pehla kaam', 13, 13)));
ok(show(enterInList('- bullet', 8, 8)) === '- bullet\n- |', 'bullet ke baad bullet', show(enterInList('- bullet', 8, 8)));
ok(show(enterInList('   3. andar', 11, 11)) === '   3. andar\n   4. |', 'andar wali list apni jagah aur agli ginti', show(enterInList('   3. andar', 11, 11)));
ok(show(enterInList('9. nau', 6, 6)) === '9. nau\n10. |', '9 ke baad 10', show(enterInList('9. nau', 6, 6)));

console.log('7) Enter — khaali list item par list khatam');
ok(show(enterInList('- ek\n- ', 7, 7)) === '- ek\n|', 'khaali bullet hat gaya', show(enterInList('- ek\n- ', 7, 7)));
ok(show(enterInList('1. ek\n2. ', 9, 9)) === '1. ek\n|', 'khaali ginti hat gayi', show(enterInList('1. ek\n2. ', 9, 9)));

console.log('8) Enter — jahan kuch nahi hona chahiye');
ok(enterInList('saadi line', 10, 10) === null, 'saadi line par null (Enter aam tarike se chale)');
ok(enterInList('', 0, 0) === null, 'khaali box par null');
ok(show(enterInList('1. ek\n2. do', 11, 11)) === '1. ek\n2. do\n3. |', 'doosri line ke ant par bhi sahi ginti', show(enterInList('1. ek\n2. do', 11, 11)));

console.log('9) Enter — line ke BEECH me, aur kuch chuna hua ho');
ok(show(enterInList('1. pehla', 5, 5)) === '1. pe\n2. |hla', 'beech me Enter: aage ka matn neeche, nayi ginti', show(enterInList('1. pehla', 5, 5)));
ok(show(enterInList('1. abcdef', 4, 7)) === '1. a\n2. |ef', 'chuna hua hissa hat kar nayi line bani', show(enterInList('1. abcdef', 4, 7)));

console.log('10) asli jaisa ek pura kram');
{
  let s = { value: '', start: 0, end: 0 };
  const type = (t) => { s = { value: s.value.slice(0, s.start) + t + s.value.slice(s.end), start: s.start + t.length, end: s.start + t.length }; };
  const enter = () => { const r = enterInList(s.value, s.start, s.end); s = r || { ...s, value: `${s.value.slice(0, s.start)}\n${s.value.slice(s.end)}`, start: s.start + 1, end: s.start + 1 }; };
  type('Kaam:');
  enter();
  s = toggleList(s.value, s.start, s.end, 'ol');       // Numbered list dabaya
  s = { ...s, start: s.end, end: s.end };
  type('drawing lena');
  enter();
  type('client se puchhna');
  enter();
  enter();                                              // khaali item → list khatam
  type('baaki kal.');
  ok(s.value === 'Kaam:\n1. drawing lena\n2. client se puchhna\nbaaki kal.',
    'list bani, do item, phir khud khatam', JSON.stringify(s.value));
}

console.log(`\n${fail ? 'FAIL' : 'PAAS'}: ${pass} paas, ${fail} fail`);
process.exit(fail ? 1 : 0);
