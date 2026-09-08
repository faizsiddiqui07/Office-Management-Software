/**
 * The web app manifest — /manifest.webmanifest
 *
 * It is generated rather than shipped as a static file because of ONE hard browser rule:
 * the `sizes` a manifest declares for an icon must match the image's REAL pixel size. If
 * they disagree the browser discards that icon, and an app with no usable icon is not
 * installable at all — no install button, no address-bar icon, nothing. Chrome says so in
 * as many words: "Actual size (800x800)px of Icon /app-icon does not match specified size
 * (512x512)" followed by "Manifest does not contain a suitable icon".
 *
 * The icon is not ours to fix at a fixed size: it is uploaded from Settings and can be any
 * dimensions, so a hard-coded `sizes` is wrong the moment somebody uploads a different
 * image. So the real bytes are measured here and the manifest declares the truth.
 *
 * If the icon can't be measured, or is a format browsers won't take for an install icon
 * (JPEG is not accepted — only PNG, SVG and WebP are), it falls back to the built-in SVG
 * mark declared as `sizes: "any"`, which is always valid. The app therefore stays
 * installable no matter what has been uploaded.
 */
export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Real pixel size + type of an image, straight from its header. No image library needed. */
function measure(buf) {
  const b = new Uint8Array(buf);
  // PNG — IHDR carries width/height as big-endian uint32 at bytes 16 and 20.
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(buf);
    return { type: 'image/png', w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  // WebP — only the extended (VP8X) form carries the canvas size in a fixed place.
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[12] === 0x56 && b[15] === 0x58) {
    const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { type: 'image/webp', w, h };
  }
  return null; // JPEG, SVG, or anything unrecognised — the caller falls back
}

/** The built-in mark: always valid, because a vector needs no size to agree with. */
const FALLBACK_ICONS = [
  { src: '/app-icon', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
];

async function iconEntries() {
  try {
    const res = await fetch(`${API_BASE}/api/settings/branding`, { cache: 'no-store' });
    if (!res.ok) return FALLBACK_ICONS;
    const iconUrl = (await res.json())?.data?.branding?.appIcon || '';

    let buf = null;
    if (iconUrl.startsWith('data:')) {
      const m = /^data:([^;,]+);base64,(.+)$/s.exec(iconUrl);
      if (m) buf = Buffer.from(m[2], 'base64').buffer;
    } else if (/^https?:\/\//i.test(iconUrl)) {
      const img = await fetch(iconUrl);
      if (img.ok) buf = await img.arrayBuffer();
    }
    if (!buf) return FALLBACK_ICONS;

    const found = measure(buf);
    // Under 144px square a browser will not treat it as an install icon at all.
    if (!found || found.w !== found.h || found.w < 144) return FALLBACK_ICONS;

    const size = `${found.w}x${found.h}`;
    return [
      { src: '/app-icon', sizes: size, type: found.type, purpose: 'any' },
      // A separate maskable entry so Android can crop it to the launcher's shape. It must
      // NOT be the only entry: an icon whose purpose is only "maskable" does not satisfy
      // the installability check, which is half of what went wrong before.
      { src: '/app-icon', sizes: size, type: found.type, purpose: 'maskable' },
    ];
  } catch {
    return FALLBACK_ICONS;
  }
}

export async function GET() {
  const manifest = {
    name: 'Architectus Bureau',
    id: '/dashboard',
    short_name: 'Architectus',
    description: 'Attendance, leaves, dues, expenses and more — your office in one place.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b0f1a',
    theme_color: '#0b0f1a',
    icons: await iconEntries(),
  };
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'Content-Type': 'application/manifest+json',
      // Short, so a newly uploaded icon (and its new size) reaches browsers quickly.
      'Cache-Control': 'public, max-age=300',
    },
  });
}
