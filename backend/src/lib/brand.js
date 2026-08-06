import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetsConfigured, uploadAsset } from './s3Assets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The company logo lives in the WEBSITE's public folder so Next.js serves it to
 * the browser (sidebar/topbar) — and the backend reads the same file to embed it
 * in PDF reports. One source of truth, no duplication.
 */
const WEBSITE_PUBLIC = path.resolve(__dirname, '../../../website/public');
export const LOGO_DIR = path.join(WEBSITE_PUBLIC, 'brand');

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
// Only raster formats @react-pdf can embed land in PDFs; svg/webp still show on the web.
const PDF_EMBEDDABLE = new Set(['png', 'jpg', 'jpeg']);

/** Resolve a public logoUrl ("/brand/logo-x.png") to an absolute file path. */
export function logoFilePath(logoUrl) {
  if (!logoUrl || typeof logoUrl !== 'string') return null;
  const rel = logoUrl.split('?')[0].replace(/^\/+/, '');
  if (!rel.startsWith('brand/')) return null;
  return path.join(WEBSITE_PUBLIC, rel);
}

/**
 * Load the logo for PDF embedding (png/jpg only). ASYNC: an S3-hosted logo is fetched
 * over HTTPS and inlined as a data URI so @react-pdf can embed it.
 * @returns {Promise<{ format:'png'|'jpg', dataUri:string } | null>}
 */
export async function loadCompanyLogo(logoUrl) {
  try {
    if (!logoUrl || typeof logoUrl !== 'string') return null;

    // Legacy storage: a base64 data URL kept directly in settings. @react-pdf can embed
    // png/jpg data URIs as-is.
    if (logoUrl.startsWith('data:')) {
      const m = /^data:image\/(png|jpe?g);base64,/i.exec(logoUrl);
      if (!m) return null; // svg/webp aren't PDF-embeddable
      return { format: /png/i.test(m[1]) ? 'png' : 'jpg', dataUri: logoUrl };
    }

    // Current storage: an https URL in the assets bucket. Small file + S3's immutable
    // cache headers; fetched fresh per PDF export, which is a rare, user-initiated action.
    if (/^https?:\/\//i.test(logoUrl)) {
      const res = await fetch(logoUrl);
      if (!res.ok) return null;
      const mime = String(res.headers.get('content-type') || '').toLowerCase();
      if (!/image\/(png|jpe?g)/.test(mime)) return null; // svg/webp aren't PDF-embeddable
      const buf = Buffer.from(await res.arrayBuffer());
      const format = mime.includes('png') ? 'png' : 'jpg';
      return { format, dataUri: `data:image/${format === 'png' ? 'png' : 'jpeg'};base64,${buf.toString('base64')}` };
    }

    // Oldest legacy: a file under website/public/brand (only present on a writable disk).
    const p = logoFilePath(logoUrl);
    if (!p || !fs.existsSync(p)) return null;
    const ext = path.extname(p).slice(1).toLowerCase();
    if (!PDF_EMBEDDABLE.has(ext)) return null;
    const format = ext === 'png' ? 'png' : 'jpg';
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    return { format, dataUri: `data:${mime};base64,${fs.readFileSync(p).toString('base64')}` };
  } catch {
    return null;
  }
}

/** Delete the file referenced by a public logo URL, if it exists. */
export function deleteLogoFile(logoUrl) {
  try {
    const p = logoFilePath(logoUrl);
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

/** Remove logo files — all, or just one variant ('light' | 'dark'). */
export function clearCompanyLogo(variant) {
  try {
    if (!fs.existsSync(LOGO_DIR)) return;
    const re = variant
      ? new RegExp(`^logo-${variant}-.*\\.(png|jpe?g|webp|svg)$`, 'i')
      : /^logo-.*\.(png|jpe?g|webp|svg)$/i;
    for (const f of fs.readdirSync(LOGO_DIR)) {
      if (re.test(f)) fs.unlinkSync(path.join(LOGO_DIR, f));
    }
  } catch {
    // ignore
  }
}

// Max decoded image size kept in the DB. Base64 inflates ~33%, and up to four
// images (2 logos + 2 backgrounds) live in the single settings doc, so this
// keeps it comfortably under MongoDB's 16MB document limit. The frontend
// downscales before upload, so this is mainly a safety net.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/**
 * Validate an uploaded image data URL, upload it to the assets bucket, and return the
 * public S3 URL to store in settings (~100 bytes instead of the whole image). If the
 * bucket isn't configured yet (ASSETS_BUCKET unset — local dev, or a deploy that landed
 * before the bucket was created), it falls back to the old behaviour of returning the
 * data URL for storage in the document, so uploads never hard-fail.
 * @param {string} dataUrl  e.g. "data:image/png;base64,...."
 * @param {string} keyPrefix  e.g. "logo-dark" / "bg-light"
 * @returns {Promise<string>} the URL (or data URL fallback) to store in settings
 */
async function saveMedia(dataUrl, keyPrefix) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) {
    const e = new Error('Invalid image data');
    e.status = 400;
    e.code = 'BAD_IMAGE';
    throw e;
  }
  const mime = m[1].toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) {
    const e = new Error('Unsupported image type — use PNG, JPG, WEBP or SVG');
    e.status = 400;
    e.code = 'BAD_IMAGE_TYPE';
    throw e;
  }
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) {
    const e = new Error('Image is too large — please use one under 3 MB (a smaller or more compressed image).');
    e.status = 413;
    e.code = 'IMAGE_TOO_LARGE';
    throw e;
  }
  if (!assetsConfigured()) return dataUrl; // graceful fallback: store in the doc, old-style
  return uploadAsset({ buffer, contentType: mime, keyPrefix, ext });
}

/** Validate + upload a company logo (or the square app icon); returns the URL to store. */
export function saveCompanyLogo(dataUrl, variant = 'dark') {
  const prefix = variant === 'icon' ? 'app-icon' : `logo-${variant === 'light' ? 'light' : 'dark'}`;
  return saveMedia(dataUrl, prefix);
}

/** Validate + upload an app background; returns the URL to store. */
export function saveBackground(dataUrl, variant = 'dark') {
  return saveMedia(dataUrl, `bg-${variant === 'light' ? 'light' : 'dark'}`);
}
