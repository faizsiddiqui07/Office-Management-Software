import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

/**
 * Branding images (logos + app backgrounds) live in an S3 bucket, NOT in the database.
 *
 * They used to be stored as base64 blobs inside the Setting document — which grew it to
 * ~0.9 MB and, on a bandwidth-throttled Atlas tier, made every settings read take ~9s
 * (the 2026-08-06 incident). Now the database keeps only the tiny S3 URL; the browser
 * loads the image straight from S3 with a year-long immutable cache.
 *
 * Keys are versioned with a timestamp (`branding/bg-dark-1723456789.jpg`) so replacing an
 * image always produces a NEW URL — browser/CDN caches can never show a stale file, which
 * is what makes the aggressive Cache-Control safe.
 *
 * Config: ASSETS_BUCKET (Lambda env var). Without it, callers fall back to the old
 * store-in-DB behaviour, so a deploy that lands before the bucket exists degrades
 * gracefully instead of breaking uploads.
 */

const REGION = process.env.ASSETS_REGION || process.env.AWS_REGION || 'ap-south-1';

let client = null;
function s3() {
  if (!client) client = new S3Client({ region: REGION });
  return client;
}

export function assetsConfigured() {
  return !!process.env.ASSETS_BUCKET;
}

export function assetBaseUrl() {
  return `https://${process.env.ASSETS_BUCKET}.s3.${REGION}.amazonaws.com/`;
}

/** True only for URLs inside OUR bucket's branding/ area — the only thing we may delete. */
export function isAssetUrl(url) {
  return assetsConfigured() && typeof url === 'string' && url.startsWith(`${assetBaseUrl()}branding/`);
}

/** Upload one image; returns its permanent public URL. */
export async function uploadAsset({ buffer, contentType, keyPrefix, ext }) {
  const key = `branding/${keyPrefix}-${Date.now()}.${ext}`;
  await s3().send(new PutObjectCommand({
    Bucket: process.env.ASSETS_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable', // safe: every version is a new key
  }));
  return assetBaseUrl() + key;
}

/**
 * Best-effort delete of a previously-uploaded asset. Ignores anything that isn't ours
 * (legacy base64 data URLs, empty strings, foreign URLs) and never throws — a failed
 * cleanup must not fail the settings save that triggered it.
 */
export async function deleteAsset(url) {
  if (!isAssetUrl(url)) return;
  const key = url.slice(assetBaseUrl().length).split('?')[0];
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: process.env.ASSETS_BUCKET, Key: key }));
  } catch (e) {
    console.error('asset delete failed', key, e?.message);
  }
}
