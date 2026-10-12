/**
 * Site attendance ki selfie — S3 par rakhna aur dikhana.
 *
 * `chatMedia.js` ka chhota bhai, aur jaan-bujh kar alag file: bucket wahi hai par niyam
 * alag hain. Chat 25 MB tak kuch bhi bhejta hai aur uska daily quota hai; selfie ek
 * compress ki hui JPEG hai, har din do, aur uska koi quota nahi. Dono ko ek hi file me
 * ghusane se dono ke niyam ulajh jaate.
 *
 * PHOTO SERVER SE HOKAR NAHI JAATI. Browser ko ek "presigned POST" diya jaata hai — ek
 * baar ka permission slip — aur wo seedha S3 par chadhata hai. Wajah: backend Lambda par
 * hai aur ek request me ~6 MB se zyada aa hi nahi sakta, aur photo ko Lambda ke through
 * bhejna dheema bhi hai aur mehenga bhi.
 *
 * Bucket env var ka naam `CHAT_MEDIA_BUCKET` hi hai — bucket ek hi hai
 * (`architectus-bureau-office-assets`), bas prefix alag: `attendance/`. Naya var banane se
 * ek aur cheez AWS console me set karni padti aur bhoolne par upload chupchaap band hota.
 */
import crypto from 'node:crypto';

const region = () => process.env.ASSETS_REGION || process.env.AWS_REGION || 'ap-south-1';
const bucket = () => process.env.CHAT_MEDIA_BUCKET || '';
const KEY = process.env.APP_ENC_KEY || process.env.JWT_SECRET || '';
const TOKEN_SECRET = crypto
  .createHash('sha256')
  .update(`attendance-selfie|${KEY || 'dev-insecure-secret-change-me'}`)
  .digest();

/** Compress ki hui selfie iske aas-paas hoti hai; 2 MB me aaram se aa jaati hai. */
export const MAX_SELFIE_BYTES = 2 * 1024 * 1024;
const TOKEN_TTL_MS = 15 * 60 * 1000;  // photo lene se submit tak ke liye kaafi
const VIEW_URL_SECONDS = 300;         // dekhne ka link 5 minute

/** Bucket set hai ya nahi — nahi hai to app selfie ka button hi nahi dikhata. */
export function attendanceSelfieConfigured() {
  return !!bucket();
}

let client = null;
async function s3() {
  if (!client) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    client = new S3Client({ region: region() });
  }
  return client;
}

const b64u = (b) => Buffer.from(b).toString('base64url');

/** `attendance/2026/10/<32 hex>.jpg` — naam me kisi ki pehchan nahi, sirf tareekh. */
function newKey() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `attendance/${y}/${m}/${crypto.randomBytes(16).toString('hex')}.jpg`;
}

function signToken(key, userId) {
  const payload = b64u(JSON.stringify({ k: key, u: String(userId), exp: Date.now() + TOKEN_TTL_MS }));
  const sig = b64u(crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}

/**
 * Parchi padho — sahi, bina expire hui, aur ISI bande ki ho to uska key, warna null.
 *
 * `u` ka match zaroori hai: iske bina koi apni parchi se doosre ke naam par photo laga
 * sakta tha. Signature compare timing-safe hai.
 */
export function readSelfieToken(token, userId) {
  try {
    const [payload, sig] = String(token || '').split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!p.k || !p.exp || Date.now() > p.exp) return null;
    if (String(p.u) !== String(userId)) return null;
    return { key: p.k };
  } catch {
    return null;
  }
}

/**
 * Browser ke liye ek baar ka upload permission.
 *
 * `content-length-range` seema S3 PAR hi lagti hai — browser jhooth bole to bhi S3 khud
 * thukra dega. Ye zaroori hai kyunki bytes server ko chhoote hi nahi, to server khud naap
 * nahi sakta ki file kitni badi thi.
 */
export async function signSelfieUpload(userId) {
  if (!bucket()) throw new Error('CHAT_MEDIA_BUCKET is not configured');
  const { createPresignedPost } = await import('@aws-sdk/s3-presigned-post');
  const c = await s3();
  const key = newKey();
  const post = await createPresignedPost(c, {
    Bucket: bucket(),
    Key: key,
    Expires: 600,
    Fields: { 'Content-Type': 'image/jpeg' },
    Conditions: [['content-length-range', 1, MAX_SELFIE_BYTES], ['eq', '$Content-Type', 'image/jpeg']],
  });
  return { key, token: signToken(key, userId), url: post.url, fields: post.fields };
}

/** Photo sach me chadhi thi ya nahi (aur kitni badi) — submit se pehle ki jaanch. */
export async function selfieExists(key) {
  if (!bucket() || !key) return null;
  try {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const c = await s3();
    const out = await c.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { bytes: out.ContentLength || 0 };
  } catch {
    return null;
  }
}

/** Dekhne ke liye 5 minute ka link. Bucket private hi rehta hai. */
export async function signSelfieView(key) {
  if (!bucket() || !key) return '';
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const c = await s3();
  const cmd = new GetObjectCommand({ Bucket: bucket(), Key: key, ResponseContentType: 'image/jpeg' });
  return getSignedUrl(c, cmd, { expiresIn: VIEW_URL_SECONDS });
}
