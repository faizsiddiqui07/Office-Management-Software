/**
 * Same-origin app icon — /app-icon
 *
 * Browsers want the favicon / PWA-install icon on the site's own origin (cross-origin
 * icons break "Add to Home Screen" on iOS and are flaky in the manifest). But the icon
 * itself is managed from Settings and lives in S3, and the frontend ships with NO image
 * files. This route bridges the two: it looks the current icon URL up from the public
 * branding endpoint and streams the bytes through, so the browser sees a same-origin
 * image while leadership can change it from the website any time.
 *
 * It NEVER 404s. A 404 favicon renders as a blank browser tab (and a broken PWA icon),
 * and it also gets cached hard — which is exactly what left the tab blank when the route
 * was hit once before any icon had been uploaded. So every unhappy path (no icon yet,
 * branding/S3 unreachable, a malformed value) falls back to an inline-generated default
 * mark. No file is added to public/ — the default is built in code.
 *
 * Cached for 5 minutes (plus the ?v= query in the metadata) so an icon change shows up
 * quickly without hammering S3; the default caches for only 1 minute so a freshly
 * uploaded custom icon replaces it fast.
 */
export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Built-in fallback so the tab is NEVER blank before a custom icon is uploaded (or if
// branding/S3 is briefly unreachable). An SVG is a valid favicon in every evergreen
// browser; a real uploaded PNG overrides it as soon as one exists.
const DEFAULT_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">' +
  '<rect width="512" height="512" rx="112" fill="#0b0f1a"/>' +
  '<text x="50%" y="53%" text-anchor="middle" dominant-baseline="middle" ' +
  'font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="300" ' +
  'font-weight="700" fill="#ffffff">A</text></svg>';

function defaultIcon() {
  return new Response(DEFAULT_ICON, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=60' },
  });
}

export async function GET() {
  try {
    const bRes = await fetch(`${API_BASE}/api/settings/branding`, { cache: 'no-store' });
    if (!bRes.ok) return defaultIcon();
    const body = await bRes.json();
    const iconUrl = body?.data?.branding?.appIcon || '';

    // A data-URL (legacy storage / bucket-less fallback) can be served directly too.
    if (iconUrl.startsWith('data:')) {
      const m = /^data:([^;,]+);base64,(.+)$/s.exec(iconUrl);
      if (!m) return defaultIcon();
      return new Response(Buffer.from(m[2], 'base64'), {
        headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=300' },
      });
    }
    if (!/^https?:\/\//i.test(iconUrl)) return defaultIcon(); // no icon uploaded yet

    const img = await fetch(iconUrl);
    if (!img.ok) return defaultIcon();
    const bytes = await img.arrayBuffer();
    return new Response(bytes, {
      headers: {
        'Content-Type': img.headers.get('content-type') || 'image/png',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch {
    return defaultIcon();
  }
}
