import crypto from 'node:crypto';

/**
 * Chat ki files — S3 par, browser se SEEDHA.
 *
 * Lambda ke through upload karna kyun nahi: API Gateway ka payload cap ~6 MB hai (aur
 * base64 usse aur phula deta hai), Lambda ka 10 MB, aur timeout 30 second — yaani ek
 * choti si video bhi nahi ja sakti. Isliye server sirf ek "presigned POST" deta hai aur
 * browser bytes khud S3 ko bhejta hai. Bytes Lambda ko chhoote hi nahi.
 *
 * BUCKET WAHI PURANA hai (`architectus-bureau-office-assets`), `chat/` prefix ke saath.
 * Pehle yahan "alag bucket lo" likha tha — kyunki us bucket ke `branding/` par public-read
 * policy hai (logo bina login ke dikhna chahiye). Jaanch par wo policy `/branding/*` tak
 * hi seemit nikli, aur uske baad bucket par Block-public-access ke teen switch ON kar
 * diye gaye — jisme "koi nayi/badli hui public policy nahi" bhi hai. Yaani `chat/` par ab
 * do taale hain: policy usse chhooti hi nahi, aur policy widen ho hi nahi sakti.
 *
 * Isliye bucket ka naam yahan kabhi mat likhna — sirf CHAT_MEDIA_BUCKET padho. Kal ko
 * alag bucket lena ho to sirf env var badlega, ye file nahi. Poora byora aur console ke
 * steps: backend/DEPLOY-CHAT-MEDIA.md
 *
 * Download hamesha 5 minute wale signed link se hota hai — public URL kabhi nahi.
 *
 * Key me kuch NAHI bataya jaata — na kiski file hai, na kis chat ki, na filename, na
 * extension. Sirf tareekh aur random. Warna bucket ki listing se hi "kisne kisko kya
 * bheja" ka naksha ban jaata. Asli naam aur MIME message ke document me rehte hain (naam
 * encrypted), aur S3 par har object ka Content-Type `application/octet-stream` hi rehta
 * hai.
 */

/**
 * Env har baar padha jaata hai, module load par ek baar nahi.
 *
 * Module-level par pakad lena yahan dhokha deta hai: ESM ke import sabse pehle chalte
 * hain, isliye jo bhi baad me env set kare (test ya koi wrapper) uska asar hi nahi hota —
 * aur code "bucket set hi nahi hai" maan kar chupchap mana kar deta hai. Lambda par dono
 * ek jaise hain (env pehle se set hota hai), par saaf raasta yahi hai.
 */
const region = () => process.env.ASSETS_REGION || process.env.AWS_REGION || 'ap-south-1';
const bucket = () => process.env.CHAT_MEDIA_BUCKET || '';
const KEY = process.env.APP_ENC_KEY || process.env.JWT_SECRET || '';
const TOKEN_SECRET = crypto
  .createHash('sha256')
  .update(`chat-upload|${KEY || 'dev-insecure-secret-change-me'}`)
  .digest();

/** Phase 3 ki seema. Isse bada bhejna multipart + chunking maangta hai (baad ka kaam). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Ek banda ek din me kitna bhej sakta hai — badtameezi ki brake. */
export const DAILY_QUOTA_BYTES = 200 * 1024 * 1024;
const UPLOAD_TOKEN_TTL_MS = 30 * 60 * 1000; // upload + message bhejne ke liye kaafi
const GET_URL_SECONDS = 300; // 5 minute

export function chatMediaConfigured() {
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

/** `chat/2026/09/<32 hex>.b` — koi pehchan nahi, sirf tareekh aur ittefaq. */
function newKey(suffix) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `chat/${y}/${m}/${crypto.randomBytes(16).toString('hex')}${suffix}`;
}

const b64u = (b) => Buffer.from(b).toString('base64url');

/**
 * Upload ki parchi.
 *
 * Client jo key laut kar bhejta hai, uspar bharosa nahi kiya ja sakta — warna koi bhi
 * kisi doosri chat ki file ka key likh kar use apne message me chipka deta. Isliye key
 * server banata hai aur HMAC se sign karke deta hai; message banate waqt wahi signature
 * dobara jaancha jaata hai.
 */
function signUploadToken({ key, thumbKey, conversationId, userId }) {
  const payload = b64u(JSON.stringify({
    k: key, t: thumbKey || '', c: String(conversationId), u: String(userId), exp: Date.now() + UPLOAD_TOKEN_TTL_MS,
  }));
  const sig = b64u(crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Parchi padho — sahi aur isi bande/chat ki ho to uska payload, warna null. */
export function readUploadToken(token, { conversationId, userId }) {
  try {
    const [payload, sig] = String(token || '').split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!p.k || !p.exp || Date.now() > p.exp) return null;
    if (String(p.c) !== String(conversationId) || String(p.u) !== String(userId)) return null;
    return { key: p.k, thumbKey: p.t || '' };
  } catch {
    return null;
  }
}

/**
 * Browser ke liye presigned POST — ek file ke liye, aur ek chhote thumbnail ke liye.
 *
 * `content-length-range` S3 par hi seema laga deta hai: browser jhooth bole to bhi S3
 * khud upload thukra dega. Ye zaroori hai kyunki bytes server ko chhoote hi nahi, to
 * server "kitna bada hai" khud naap nahi sakta.
 */
export async function signUpload({ conversationId, userId, withThumb = false }) {
  if (!bucket()) throw new Error('CHAT_MEDIA_BUCKET is not configured');
  const { createPresignedPost } = await import('@aws-sdk/s3-presigned-post');
  const c = await s3();

  const key = newKey('.b');
  const thumbKey = withThumb ? newKey('.t') : '';

  const common = {
    Bucket: bucket(),
    Expires: 600, // 10 minute — dheemi mobile line par bhi kaafi
    // Har object ek jaisa dikhta hai. S3 ki metadata se hi ye pata na chale ki PDF bheji
    // gayi thi ya video — asli MIME sirf message ke document me hai.
    Fields: { 'Content-Type': 'application/octet-stream' },
  };

  const file = await createPresignedPost(c, {
    ...common,
    Key: key,
    Conditions: [['content-length-range', 1, MAX_FILE_BYTES], ['eq', '$Content-Type', 'application/octet-stream']],
  });
  const thumb = thumbKey
    ? await createPresignedPost(c, {
        ...common,
        Key: thumbKey,
        Conditions: [['content-length-range', 1, 512 * 1024], ['eq', '$Content-Type', 'application/octet-stream']],
      })
    : null;

  return {
    key,
    thumbKey,
    uploadToken: signUploadToken({ key, thumbKey, conversationId, userId }),
    file: { url: file.url, fields: file.fields },
    thumb: thumb ? { url: thumb.url, fields: thumb.fields } : null,
    maxBytes: MAX_FILE_BYTES,
  };
}

/**
 * S3 se poochho ki object sach me hai aur kitna bada hai.
 *
 * Client ka bataya hua size maan lena galat hota: quota jhooth se bach jaata, aur ek
 * message bina file ke bhi ban sakta tha (key likh do, upload karo hi mat).
 */
export async function headObject(key) {
  if (!bucket()) return null;
  try {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const c = await s3();
    const out = await c.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { size: Number(out.ContentLength) || 0 };
  } catch {
    return null;
  }
}

/** Download ka 5-minute wala link. Public URL kabhi nahi. */
export async function signDownload(key, { filename, mime } = {}) {
  if (!bucket() || !key) return '';
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const c = await s3();
  const cmd = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    // Asli naam aur type SIRF is signed link par chipkaye jaate hain — S3 par object
    // hamesha gumnaam octet-stream hi pada rehta hai.
    ...(mime ? { ResponseContentType: mime } : {}),
    ...(filename
      ? { ResponseContentDisposition: `inline; filename="${String(filename).replace(/["\\\r\n]/g, '_')}"` }
      : {}),
  });
  // 5 minute: link khud ek chaabi hai (jiske paas hai wo khol sakta hai), isliye umar
  // chhoti rakhi hai. Lambda ke role ki credentials bhi arzi hoti hain — lambi expiry
  // waise bhi jaldi mar jaati.
  return getSignedUrl(c, cmd, { expiresIn: GET_URL_SECONDS });
}

/** Message hatane par bytes bhi hataao. */
export async function deleteObjects(keys = []) {
  const list = keys.filter(Boolean);
  if (!bucket() || !list.length) return;
  try {
    const { DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
    const c = await s3();
    await c.send(new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: list.map((Key) => ({ Key })), Quiet: true },
    }));
  } catch {
    // Bytes reh gaye to sirf thoda storage kharch hoga — message to ja hi chuka hai.
  }
}
