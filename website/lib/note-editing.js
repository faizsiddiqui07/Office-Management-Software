/**
 * Note-editor ke andar ka ganit — matn + cursor andar, naya matn + naya cursor bahar.
 *
 * React se alag isliye hai ki ye wahi hissa hai jisme galti hoti hai (cursor kahan
 * jaayega, selection ka kya hoga, list kaise aage badhegi) — aur ise seedha chala kar
 * parkha ja sakta hai: scripts/test-note-editing.mjs.
 *
 * Har function ek hi aakaar lautata hai: { value, start, end }.
 */
// Extension ke saath: ye file bina bundler ke bhi chalti hai (scripts/test-note-editing.mjs
// use seedha `node` se chalata hai), aur Next ke liye dono tarah chalta hai.
import { nextListPrefix, emptyListItem } from './rich-text.js';

/** Us line ki shuruaat jisme `pos` hai. */
const lineStart = (value, pos) => value.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
/** Us line ka ant jisme `pos` hai. */
const lineEnd = (value, pos) => {
  const i = value.indexOf('\n', pos);
  return i === -1 ? value.length : i;
};

/**
 * Chune hue matn ko nishaan se lapet do (bold, italic, …) — ya nishaan hata do agar
 * pehle se laga hai.
 *
 * Kuch chuna hi na ho to nishaan daal kar cursor unke BEECH me rakha jaata hai, taaki
 * banda seedha likhna shuru kar sake — Claude/WhatsApp jaisa.
 */
export function toggleWrap(value, start, end, mark) {
  const v = String(value ?? '');
  const sel = v.slice(start, end);
  const m = mark.length;

  // Pehle se lapeta hua? Do tarah se: nishaan selection ke ANDAR hain, ya BAHAR.
  if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= m * 2 + 1) {
    const inner = sel.slice(m, -m);
    return { value: v.slice(0, start) + inner + v.slice(end), start, end: start + inner.length };
  }
  if (v.slice(Math.max(0, start - m), start) === mark && v.slice(end, end + m) === mark) {
    return {
      value: v.slice(0, start - m) + sel + v.slice(end + m),
      start: start - m,
      end: end - m,
    };
  }

  if (start === end) {
    // Kuch chuna nahi — nishaan daalo aur cursor beech me.
    return { value: v.slice(0, start) + mark + mark + v.slice(start), start: start + m, end: start + m };
  }
  return { value: v.slice(0, start) + mark + sel + mark + v.slice(end), start: start + m, end: end + m };
}

/**
 * Chuni hui har line ko list banao — ya pehle se list ho to wapas saada karo.
 *
 * `kind`: 'ul' ya 'ol'. Ginti wali list har baar 1 se gini jaati hai.
 */
export function toggleList(value, start, end, kind) {
  const v = String(value ?? '');
  const from = lineStart(v, start);
  const to = lineEnd(v, end);
  const lines = v.slice(from, to).split('\n');
  const stripped = lines.map((l) => l.replace(/^(\s*)([-*]|\d+[.)])\s+/, '$1'));
  const alreadyThisKind = lines.every((l) => (kind === 'ul' ? /^\s*[-*]\s+/ : /^\s*\d+[.)]\s+/).test(l));

  const next = alreadyThisKind
    ? stripped
    : stripped.map((l, i) => {
      const indent = /^\s*/.exec(l)[0];
      const body = l.slice(indent.length);
      return `${indent}${kind === 'ol' ? `${i + 1}. ` : '- '}${body}`;
    });

  const block = next.join('\n');
  const grew = block.length - (to - from);
  const out = v.slice(0, from) + block + v.slice(to);

  /**
   * Cursor kahan jaaye — ek line par aur kai line par alag.
   *
   * KUCH CHUNA HI NAHI THA (aam haalat: khaali box me "Numbered list" dabana):
   * cursor us line ke ANT me, yaani "1. " ke theek baad — banda turant likhna shuru kare.
   * Pehle yahan poora badla hua hissa CHUNA chhod diya jaata tha, to naya "1. " khud hi
   * highlight rehta aur agla akshar use mita deta tha: banda jo likhta, "1. " gayab.
   * Pehle use deselect karna padta tha. Owner ne pakda (31 Oct 2026).
   *
   * KUCH CHUNA HUA THA (kai line ek saath list banayin): chuna hua hi rehta hai. Wajah
   * seedhi hai — dobara button dabane par POORA block wapas saada ho jaaye. Cursor ek
   * line par chhod dete to sirf wahi ek line hatti.
   */
  if (start === end) {
    const caret = lineEnd(out, from);
    return { value: out, start: caret, end: caret };
  }
  return { value: out, start: from, end: to + grew };
}

/**
 * Enter dabaya gaya — list apne aap aage badhe.
 *
 * Teen soorat:
 *   1. list wali line par kuch likha hai  → agli line uska agla nishaan le kar shuru ho
 *      ("1. kaam" ke baad Enter → "2. ")
 *   2. list wali line KHAALI hai          → nishaan hat jaaye, list wahin khatam
 *   3. saadi line                          → null, yaani Enter ko aam tarike se chalne do
 *
 * Kuch chuna hua ho to bhi theek chalta hai: chuna hua hissa pehle hat jaata hai.
 */
export function enterInList(value, start, end) {
  const v = String(value ?? '');
  const from = lineStart(v, start);
  const line = v.slice(from, start);

  if (emptyListItem(line) && start === end) {
    // Khaali list item — poora nishaan hata kar saadi khaali line chhod do.
    return { value: v.slice(0, from) + v.slice(start), start: from, end: from };
  }
  const prefix = nextListPrefix(line);
  if (!prefix) return null;

  const insert = `\n${prefix}`;
  return {
    value: v.slice(0, start) + insert + v.slice(end),
    start: start + insert.length,
    end: start + insert.length,
  };
}
