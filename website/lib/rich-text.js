/**
 * Notes/announcements me halki formatting — likhne ka tareeka Claude ke box jaisa.
 *
 * Yahan sirf PADHNE-SAMAJHNE ka hissa hai: matn andar, ek saada dhancha bahar. React
 * kuch nahi, DOM kuch nahi — isliye ise seedha chala kar parkha ja sakta hai
 * (scripts/test-rich-text.mjs). Dikhane wala hissa components/ui/rich-text.jsx me hai,
 * aur likhne wala components/ui/note-editor.jsx me.
 *
 * KYUN AISE, AUR KYUN ITNA HI
 * - Matn DB me jaisa likha gaya waisa hi jaata hai — markdown ke nishaan ke saath. Koi
 *   HTML save nahi hota, isliye kahin bhi safai (sanitise) ka sawaal hi nahi uthta, aur
 *   aaj se pehle likhe hue saare notes bina chhue chalte rehte hain.
 * - Dikhate waqt React ke elements bante hain, HTML ki string kabhi nahi — yaani
 *   dangerouslySetInnerHTML kahin nahi, aur kisi ke likhe note se script chalna
 *   namumkin hai.
 * - Jaan-boojhkar chhota rakha hai. Jitna zyada niyam, utni zyada aisi line jo banda
 *   saadi samajh kar likhe aur screen par kuch aur dikhe. Sirf wahi liya hai jo log
 *   WhatsApp/Claude me pehle se likhte hain.
 *
 * KYA SAMAJHTA HAI
 *   **bold**        `*italic*` ya _italic_        ~~kaata hua~~        `code`
 *   - bullet (ya * bullet)        1. ginti wali list
 *   khaali line = naya paragraph; ek newline = usi paragraph me agli line
 *   http(s):// se shuru hone wala pata apne aap link ban jaata hai
 */

/** Ek list ka item kis tarah shuru hua — editor aur parser dono isi ko maante hain. */
const BULLET_RE = /^(\s*)([-*])\s+(.*)$/;
const NUMBER_RE = /^(\s*)(\d+)([.)])\s+(.*)$/;

/** Khaali list item ("- " ya "1. " ke baad kuch nahi) — Enter par ye hat jaata hai. */
export function emptyListItem(line) {
  const b = BULLET_RE.exec(line);
  if (b) return b[3].trim() === '';
  const n = NUMBER_RE.exec(line);
  if (n) return n[4].trim() === '';
  return false;
}

/**
 * Is line ke baad Enter dabane par agli line kya apne aap shuru honi chahiye?
 *
 * Lautata hai: bullet par wahi nishaan, ginti par AGLI ginti, warna null.
 * Yahi "1. … Enter … 2." wala jaadu hai — editor isi ek function se chalta hai.
 */
export function nextListPrefix(line) {
  const b = BULLET_RE.exec(line);
  if (b) return b[3].trim() === '' ? null : `${b[1]}${b[2]} `;
  const n = NUMBER_RE.exec(line);
  if (n) return n[4].trim() === '' ? null : `${n[1]}${Number(n[2]) + 1}${n[3]} `;
  return null;
}

// ── Inline (ek line ke andar) ────────────────────────────────────────────────
//
// Kram maayne rakhta hai: `**` ko `*` se PEHLE dekhna hoga, warna "**a**" italic ban
// jaata. Code ko sabse pehle, taaki `**` jaise nishaan code ke andar jyon ke tyon rahein.
const INLINE = [
  { type: 'code', re: /`([^`\n]+)`/ },
  { type: 'bold', re: /\*\*([^\s*](?:[^*]*[^\s*])?)\*\*/ },
  { type: 'strike', re: /~~([^\s~](?:[^~]*[^\s~])?)~~/ },
  { type: 'italic', re: /\*([^\s*](?:[^*]*[^\s*])?)\*/ },
  // Underscore SIRF shabd ke kinare par. Bina iske "file_name_here.pdf" ka beech ka
  // hissa tedha ho jaata tha aur "EMP_0001 aur EMP_0002" ke do alag underscore aapas me
  // jud jaate the — yaani jo banda saada likhta hai wo screen par kuch aur dikhta. Taare
  // (*) par ye rok nahi chahiye: wahan "5 * 3" waise hi bach jaata hai, kyunki nishaan ke
  // turant baad space nahi chalta.
  { type: 'italic', re: /(?<![A-Za-z0-9])_([^\s_](?:[^_]*[^\s_])?)_(?![A-Za-z0-9])/ },
];
// Pate ke ant me laga viraam/bracket link ka hissa nahi hota — "(dekho https://x.com)"
// me aakhri ")" bahar rehna chahiye.
const LINK_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/;

/**
 * Ek line ko tukdon me todo: saada matn, bold, italic, code, kaata hua, link.
 * Nested nahi (bold ke andar italic nahi) — jaan-boojhkar, upar wali wajah se.
 */
export function parseInline(text) {
  const out = [];
  let rest = String(text ?? '');
  while (rest) {
    // Sabse PEHLE jo milta hai wahi jeetta hai; barabari par upar wala niyam.
    let best = null;
    for (const rule of INLINE) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { rule, m };
    }
    const lm = LINK_RE.exec(rest);
    if (lm && (!best || lm.index < best.m.index)) best = { rule: { type: 'link' }, m: lm };

    if (!best) { out.push({ type: 'text', value: rest }); break; }
    if (best.m.index > 0) out.push({ type: 'text', value: rest.slice(0, best.m.index) });
    if (best.rule.type === 'link') out.push({ type: 'link', value: best.m[0], href: best.m[0] });
    else if (best.rule.type === 'code') out.push({ type: 'code', value: best.m[1] });
    else out.push({ type: best.rule.type, children: parseInline(best.m[1]) });
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

/**
 * Poore matn ko blocks me todo — paragraph aur list.
 *
 * @returns {Array<{type:'p', lines: Array}|{type:'ul'|'ol', start?: number, items: Array}>}
 */
export function parseRichText(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!src.trim()) return [];
  const blocks = [];
  let para = null; // { type:'p', lines: [] }
  let list = null; // { type:'ul'|'ol', start, items: [] }
  const closePara = () => { if (para) { blocks.push(para); para = null; } };
  const closeList = () => { if (list) { blocks.push(list); list = null; } };

  for (const raw of src.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { closePara(); closeList(); continue; } // khaali line sab band karti hai

    const b = BULLET_RE.exec(line);
    const n = b ? null : NUMBER_RE.exec(line);
    if (b || n) {
      closePara();
      const kind = b ? 'ul' : 'ol';
      if (list && list.type !== kind) closeList(); // bullet se ginti par jaana = nayi list
      if (!list) list = { type: kind, items: [], ...(n ? { start: Number(n[2]) } : {}) };
      list.items.push(parseInline(b ? b[3] : n[4]));
      continue;
    }

    closeList();
    if (!para) para = { type: 'p', lines: [] };
    para.lines.push(parseInline(line));
  }
  closePara();
  closeList();
  return blocks;
}

/**
 * Nishaan hata kar saada matn — un jagahon ke liye jahan ek hi line dikhani hai
 * (dashboard ka preview, notification ka matn, chat list ki aakhri line, PDF).
 * Wahan `**` chhaapna formatting dikhane se bhi bura hai.
 */
export function plainText(text) {
  const flat = (nodes) => nodes.map((x) => (x.children ? flat(x.children) : x.value)).join('');
  return parseRichText(text)
    .map((bk) => (bk.type === 'p'
      ? bk.lines.map(flat).join(' ')
      : bk.items.map(flat).join(' · ')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kya is matn me kuch bhi formatting hai? (toolbar/hint dikhane ke faisle ke liye.) */
export function hasFormatting(text) {
  return plainText(text) !== String(text ?? '').replace(/\s+/g, ' ').trim();
}
