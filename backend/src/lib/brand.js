import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * Load the logo for PDF embedding (png/jpg only).
 * @returns {{ format:'png'|'jpg', dataUri:string } | null}
 */
export function loadCompanyLogo(logoUrl) {
  try {
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

/**
 * Save a media file (logo/background) variant from a data URL into the brand dir.
 * @param {string} dataUrl  e.g. "data:image/png;base64,...."
 * @param {number|string} version  cache-busting token (e.g. Date.now())
 * @param {string} prefix  'logo' | 'bg'
 * @param {'light'|'dark'} variant  which theme this media is for
 * @returns {string} the public URL to store in settings
 */
function saveMedia(dataUrl, version, prefix, variant = 'dark') {
  // AWS Lambda has a read-only filesystem (except /tmp, which is ephemeral) and
  // the website's public folder isn't in the function bundle — so logo/background
  // uploads can't persist there. Fail clearly instead of throwing EROFS.
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const e = new Error('Image uploads need object storage (e.g. S3) on this server. Set the logo/background by hosting the backend with a writable disk, or wire up S3.');
    e.status = 501;
    e.code = 'UPLOAD_UNSUPPORTED';
    throw e;
  }
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) {
    const e = new Error('Invalid image data');
    e.status = 400;
    e.code = 'BAD_IMAGE';
    throw e;
  }
  const ext = EXT_BY_MIME[m[1].toLowerCase()];
  if (!ext) {
    const e = new Error('Unsupported image type — use PNG, JPG, WEBP or SVG');
    e.status = 400;
    e.code = 'BAD_IMAGE_TYPE';
    throw e;
  }
  const buffer = Buffer.from(m[2], 'base64');
  fs.mkdirSync(LOGO_DIR, { recursive: true });
  const v = variant === 'light' ? 'light' : 'dark';
  const name = `${prefix}-${v}-${version}.${ext}`;
  fs.writeFileSync(path.join(LOGO_DIR, name), buffer);
  return `/brand/${name}`;
}

/** Save a company logo variant. */
export function saveCompanyLogo(dataUrl, version, variant = 'dark') {
  return saveMedia(dataUrl, version, 'logo', variant);
}

/** Save an app background variant. */
export function saveBackground(dataUrl, version, variant = 'dark') {
  return saveMedia(dataUrl, version, 'bg', variant);
}
