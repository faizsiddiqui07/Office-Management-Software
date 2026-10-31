/**
 * lib/rich-text.js — notes/announcements ki halki formatting.
 *
 * Sabse zaroori baat jo ye test pakadta hai: jo banda SAADA matn samajh kar likhta hai
 * wo screen par waisa hi dikhna chahiye. Agar "5 * 3 * 2" italic ban jaaye, ya
 * "file_name_here" ka beech ka hissa tedha ho jaaye, to formatting faayde se zyada
 * nuksaan karti hai. Isliye neeche "ye formatting NAHI banni chahiye" wale case
 * utne hi hain jitne "banni chahiye" wale.
 *
 * Run (website folder se):  node scripts/test-rich-text.mjs
 */
import {
  parseRichText, parseInline, plainText, nextListPrefix, emptyListItem, hasFormatting,
} from '../lib/rich-text.js';

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log('  ✅ ' + label); } else { fail += 1; console.log('  ❌ ' + label + '  — ' + extra); }
};

/** Inline tukdon ko ek chhoti si likhawat me badlo, taaki test padha ja sake. */
const ink = (nodes) => nodes.map((n) => {
  if (n.type === 'text') return n.value;
  if (n.type === 'code') return `\`${n.value}\``;
  if (n.type === 'link') return `<${n.href}>`;
  const inner = ink(n.children);
  return { bold: `B(${inner})`, italic: `I(${inner})`, strike: `S(${inner})` }[n.type] ?? inner;
}).join('');
const shape = (text) => parseRichText(text).map((b) => (b.type === 'p'
  ? `p[${b.lines.map(ink).join(' / ')}]`
  : `${b.type}${b.start && b.start !== 1 ? `@${b.start}` : ''}[${b.items.map(ink).join(' | ')}]`)).join(' ');

console.log('1) Enter dabane par agli line apne aap (yahi owner ne maanga tha)');
ok(nextListPrefix('1. pehla kaam') === '2. ', '"1. pehla kaam" → agli line "2. "', JSON.stringify(nextListPrefix('1. pehla kaam')));
ok(nextListPrefix('2. doosra') === '3. ', 'ginti aage badhti hai');
ok(nextListPrefix('9. nau') === '10. ', '9 ke baad 10');
ok(nextListPrefix('1) bracket wala') === '2) ', 'bracket wali ginti bhi');
ok(nextListPrefix('- bullet') === '- ', 'bullet par wahi bullet');
ok(nextListPrefix('* taara wala') === '* ', 'taare wala bullet waisa hi');
ok(nextListPrefix('   - andar wala') === '   - ', 'andar (indent) wala apni jagah rakhta hai');
ok(nextListPrefix('   3. andar ginti') === '   4. ', 'andar wali ginti bhi badhti hai');
ok(nextListPrefix('saada line') === null, 'saadi line par kuch nahi');
ok(nextListPrefix('') === null, 'khaali line par kuch nahi');
ok(nextListPrefix('1. ') === null, 'khaali list item par kuch nahi (wo hatna chahiye)');

console.log('2) khaali list item pehchanna (Enter dabane par list khatam)');
ok(emptyListItem('- ') === true, '"- " khaali hai');
ok(emptyListItem('1. ') === true, '"1. " khaali hai');
ok(emptyListItem('1.  ') === true, 'sirf space wala bhi khaali');
ok(emptyListItem('- kuch') === false, 'kuch likha hai to khaali nahi');
ok(emptyListItem('saada') === false, 'list hai hi nahi');

console.log('3) bold / italic / kaata hua / code');
ok(ink(parseInline('**zaroori**')) === 'B(zaroori)', 'bold');
ok(ink(parseInline('*halka*')) === 'I(halka)', 'italic taare se');
ok(ink(parseInline('_halka_')) === 'I(halka)', 'italic underscore se');
ok(ink(parseInline('~~hataya~~')) === 'S(hataya)', 'kaata hua');
ok(ink(parseInline('`code`')) === '`code`', 'code');
ok(ink(parseInline('ye **zaroori** hai')) === 'ye B(zaroori) hai', 'beech me bold');
ok(ink(parseInline('**a** aur **b**')) === 'B(a) aur B(b)', 'ek line me do bold');
ok(ink(parseInline('**bada** aur *chhota*')) === 'B(bada) aur I(chhota)', 'bold pehle, italic baad — ** ko * se pehle dekha jaata hai');

console.log('4) jo formatting BANNI HI NAHI CHAHIYE (sabse zaroori hissa)');
ok(ink(parseInline('5 * 3 * 2 = 30')) === '5 * 3 * 2 = 30', 'ganit ka taara italic na bane', ink(parseInline('5 * 3 * 2 = 30')));
ok(ink(parseInline('file_name_here.pdf')) === 'file_name_here.pdf', 'file ke naam ka underscore na chale', ink(parseInline('file_name_here.pdf')));
ok(ink(parseInline('2 ** 3')) === '2 ** 3', 'khaali ** jodi bold na bane', ink(parseInline('2 ** 3')));
ok(ink(parseInline('EMP_0001 aur EMP_0002')) === 'EMP_0001 aur EMP_0002', 'do alag id ke underscore na judein', ink(parseInline('EMP_0001 aur EMP_0002')));
ok(ink(parseInline('`a ** b`')) === '`a ** b`', 'code ke andar ke nishaan jyon ke tyon', ink(parseInline('`a ** b`')));
ok(ink(parseInline('* aage space hai')) === '* aage space hai', 'shuru ka "* " bullet hai, italic nahi');

console.log('5) pata (link) apne aap');
ok(ink(parseInline('dekho https://managibot.com/x')) === 'dekho <https://managibot.com/x>', 'saada link');
ok(ink(parseInline('(dekho https://a.com/p)')) === '(dekho <https://a.com/p>)', 'bracket link ke bahar rehta hai', ink(parseInline('(dekho https://a.com/p)')));
ok(ink(parseInline('site https://a.com/x. aage')) === 'site <https://a.com/x> aage'.replace('x>', 'x>.'), 'ant ka viraam bahar', ink(parseInline('site https://a.com/x. aage')));
ok(ink(parseInline('koi pata nahi')) === 'koi pata nahi', 'bina link ke kuch nahi badla');

console.log('6) paragraph aur list ka dhancha');
ok(shape('pehli line\ndoosri line') === 'p[pehli line / doosri line]', 'ek newline = usi paragraph me agli line', shape('pehli line\ndoosri line'));
ok(shape('ek\n\ndo') === 'p[ek] p[do]', 'khaali line = naya paragraph', shape('ek\n\ndo'));
ok(shape('- a\n- b') === 'ul[a | b]', 'bullet list', shape('- a\n- b'));
ok(shape('1. a\n2. b') === 'ol[a | b]', 'ginti wali list', shape('1. a\n2. b'));
ok(shape('3. teen\n4. chaar') === 'ol@3[teen | chaar]', '3 se shuru hui list 3 se hi dikhe', shape('3. teen\n4. chaar'));
ok(shape('- a\n1. b') === 'ul[a] ol[b]', 'bullet se ginti par jaana = nayi list', shape('- a\n1. b'));
ok(shape('Kaam:\n- ek\n- do\nBaaki baad me')
  === 'p[Kaam:] ul[ek | do] p[Baaki baad me]', 'paragraph → list → paragraph', shape('Kaam:\n- ek\n- do\nBaaki baad me'));
ok(shape('- **zaroori** kaam') === 'ul[B(zaroori) kaam]', 'list ke andar bold bhi', shape('- **zaroori** kaam'));
ok(shape('') === '' && shape('   ') === '' && shape(null) === '', 'khaali matn → kuch nahi');

console.log('7) saada matn (preview, notification, PDF ke liye)');
ok(plainText('**zaroori** kaam') === 'zaroori kaam', 'bold ke nishaan hat gaye');
ok(plainText('- ek\n- do') === 'ek · do', 'list ek line me');
ok(plainText('ek\n\ndo') === 'ek do', 'do paragraph ek line me');
ok(plainText('`code` bhi') === 'code bhi', 'code ke nishaan bhi hate');
ok(plainText('') === '', 'khaali ka khaali');
ok(plainText('5 * 3') === '5 * 3', 'jo formatting thi hi nahi wo waisi hi');

console.log('8) hasFormatting');
ok(hasFormatting('**a**') === true, 'bold hai');
ok(hasFormatting('saada matn') === false, 'saada matn');
ok(hasFormatting('- ek') === true, 'list bhi formatting hai');

console.log('9) asli jaisa ek poora note');
{
  const note = [
    'Site par jaane se pehle **teen** cheezein:',
    '',
    '1. Drawing ka latest version lo',
    '2. Client se _confirm_ karo',
    '3. Photo bhej dena — https://managibot.com/upload',
    '',
    'Baaki ~~kal~~ parso dekh lenge.',
  ].join('\n');
  const got = shape(note);
  ok(got === 'p[Site par jaane se pehle B(teen) cheezein:] ol[Drawing ka latest version lo | Client se I(confirm) karo | Photo bhej dena — <https://managibot.com/upload>] p[Baaki S(kal) parso dekh lenge.]',
    'poora note sahi tootta hai', got);
  ok(plainText(note).startsWith('Site par jaane se pehle teen cheezein:'), 'uska saada roop bhi theek', plainText(note).slice(0, 60));
}

console.log(`\n${fail ? 'FAIL' : 'PAAS'}: ${pass} paas, ${fail} fail`);
process.exit(fail ? 1 : 0);
