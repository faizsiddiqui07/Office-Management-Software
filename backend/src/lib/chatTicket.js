import crypto from 'node:crypto';

/**
 * WebSocket ke liye ek chhoti-umar ki parchi (ticket).
 *
 * Kyun alag parchi, seedha login token kyun nahi: browser ka WebSocket custom header
 * bhej hi nahi sakta, isliye token URL ki query string me jaata hai — aur query string
 * API Gateway/CloudWatch ke access logs me jyon ka tyon likhi jaati hai. Is app ka login
 * token ab LIFETIME hai (kabhi expire nahi hota), to use log me chhod dena ka matlab hai
 * hamesha ke liye khula hua account. Isliye ek 60-second ki parchi banti hai jo sirf
 * WebSocket kholne ke kaam aati hai — log me chhap bhi jaye to ek minute me bekaar.
 *
 * Parchi JAAN-BUJH KAR ek se zyada baar chal sakti hai (apni 60-second khidki me).
 * "Sirf ek baar" wala design zyada surakshit lagta hai par usme ek chhupa hua bug hai:
 * ek ImaanDaar reconnect jo race kar jaye ya handshake dobara ho, use 401 milta hai aur
 * banda bina wajah logout ho jaata hai. Ek minute ki khidki apne aap me kaafi tangh hai.
 *
 * Koi database nahi: HMAC se signed hai, isliye verify karne ke liye sirf key chahiye.
 */
const KEY = process.env.APP_ENC_KEY || process.env.JWT_SECRET || '';
const SECRET = crypto.createHash('sha256').update(`chat-ws|${KEY || 'dev-insecure-secret-change-me'}`).digest();
const TTL_SECONDS = 60;

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/** userId → "v1.<payload>.<signature>" */
export function issueTicket(userId) {
  const payload = b64u(JSON.stringify({ u: String(userId), exp: Date.now() + TTL_SECONDS * 1000 }));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(payload).digest());
  return `v1.${payload}.${sig}`;
}

/**
 * Parchi padho. Sahi ho to userId, warna null.
 *
 * Signature ki tulna timingSafeEqual se hoti hai — normal `===` har galat byte par
 * thoda jaldi jawab deta hai, jisse ek dhairyawan hamlawar byte-dar-byte signature
 * bana sakta hai.
 */
export function readTicket(ticket) {
  try {
    const [v, payload, sig] = String(ticket || '').split('.');
    if (v !== 'v1' || !payload || !sig) return null;
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!u || !exp || Date.now() > exp) return null;
    return u;
  } catch {
    return null;
  }
}

export const TICKET_TTL_SECONDS = TTL_SECONDS;
