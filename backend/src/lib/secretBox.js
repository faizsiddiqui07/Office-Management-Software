import crypto from 'node:crypto';

/**
 * Symmetric encryption for small secrets stored in the DB (e.g. the SMTP
 * app-password). AES-256-GCM (authenticated) with a key derived from a
 * server-side secret — the key lives in the environment, NOT in the database,
 * so a database/backup leak alone does not expose the plaintext.
 *
 * Prefers a dedicated APP_ENC_KEY; falls back to JWT_SECRET so no new env var is
 * strictly required. If NEITHER is set we would be encrypting under a public
 * constant, which is worthless — so in production we refuse to encrypt and warn
 * loudly instead of silently protecting nothing.
 *
 * NOTE: whichever secret is used must stay stable. If it changes, previously
 * stored values can no longer be decrypted and must be re-entered (see the
 * decrypt-failure signalling below, which surfaces this rather than hiding it).
 */
const APP_KEY = process.env.APP_ENC_KEY || process.env.JWT_SECRET || '';
const usingInsecureDefault = !APP_KEY;
const KEY = crypto.createHash('sha256').update(String(APP_KEY || 'dev-insecure-secret-change-me')).digest();
const IS_PROD = process.env.NODE_ENV === 'production';

if (usingInsecureDefault && IS_PROD) {
  console.error(
    '⚠️  SECURITY: neither APP_ENC_KEY nor JWT_SECRET is set — cannot safely encrypt stored secrets. ' +
      'Set APP_ENC_KEY to a 32+ character random string.',
  );
}

/** Encrypt a string → "v1:iv:tag:data" (all base64). Empty in → empty out. */
export function encryptSecret(plain) {
  if (plain == null || plain === '') return '';
  if (usingInsecureDefault && IS_PROD) {
    // Fail closed: never persist a secret under a hard-coded, public key.
    throw new Error('Encryption key is not configured — set APP_ENC_KEY (or JWT_SECRET) to a strong secret first.');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/**
 * Decrypt a blob produced by encryptSecret.
 *  - returns ''   when there is nothing stored (empty/blank input)
 *  - returns null when a value IS stored but cannot be decrypted (tamper,
 *    corruption, or the key changed) — callers must treat this as an error,
 *    NOT as "no secret", so a key rotation surfaces instead of silently
 *    switching credential sources.
 */
export function decryptSecret(blob) {
  if (!blob || typeof blob !== 'string') return '';
  try {
    const [v, ivB, tagB, dataB] = blob.split(':');
    if (v !== 'v1' || !ivB || !tagB || !dataB) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}
