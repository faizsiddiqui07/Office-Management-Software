/**
 * Kisi ke poore naam se wo hissa nikalna jisse use pukara jaata hai.
 *
 * App me ye `name.split(' ')[0]` saat alag jagah haath se likha hua tha, aur kisi me
 * bhi punctuation nahi hat rahi thi. Is office ke owner ka account hi
 * **"ADMIN. CONTROLLER"** naam se hai, to pehla shabd `"ADMIN."` nikalta tha —
 * dashboard par "Good evening, ADMIN." aur buddy me "Hi ADMIN.!" (do full stop).
 *
 * Isliye: pehla shabd lo, phir uske kinaare ki punctuation hatao. Naam ke BEECH ki
 * punctuation nahi chhuti — "D'Souza" aur "Jean-Paul" jaise naam waise ke waise rehte
 * hain, sirf aage-peeche ka `. , -` jaisa kooda jaata hai.
 *
 * Naam khaali ya sirf punctuation ka ho to poora naam hi lauta dete hain — kuch na
 * dikhane se behtar hai.
 */
export function firstName(name = '') {
  const full = String(name || '').trim();
  if (!full) return '';
  const head = full.split(/\s+/)[0] || full;
  const clean = head.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return clean || full;
}
