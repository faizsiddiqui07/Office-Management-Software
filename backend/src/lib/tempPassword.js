import crypto from 'node:crypto';

// Ambiguous characters (O/0, I/l/1) removed for read-aloud friendliness.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*?';

function pick(set, n) {
  let out = '';
  for (let i = 0; i < n; i += 1) out += set[crypto.randomInt(set.length)];
  return out;
}

function shuffle(str) {
  const arr = str.split('');
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

/** Strong temporary password: ≥2 upper, ≥2 lower, ≥2 digits, ≥2 symbols. */
export function generateTempPassword(length = 12) {
  let pwd = pick(UPPER, 2) + pick(LOWER, 4) + pick(DIGITS, 3) + pick(SYMBOLS, 2);
  while (pwd.length < length) pwd += pick(LOWER + DIGITS, 1);
  return shuffle(pwd);
}
