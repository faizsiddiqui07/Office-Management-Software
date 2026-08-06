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
 * Cached for 5 minutes (plus the ?v= query in the metadata) so an icon change shows up
 * quickly without hammering S3.
 */
export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function GET() {
  try {
    const bRes = await fetch(`${API_BASE}/api/settings/branding`, { cache: 'no-store' });
    if (!bRes.ok) return new Response(null, { status: 404 });
    const body = await bRes.json();
    const iconUrl = body?.data?.branding?.appIcon || '';

    // A data-URL (legacy storage / bucket-less fallback) can be served directly too.
    if (iconUrl.startsWith('data:')) {
      const m = /^data:([^;,]+);base64,(.+)$/s.exec(iconUrl);
      if (!m) return new Response(null, { status: 404 });
      return new Response(Buffer.from(m[2], 'base64'), {
        headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=300' },
      });
    }
    if (!/^https?:\/\//i.test(iconUrl)) return new Response(null, { status: 404 });

    const img = await fetch(iconUrl);
    if (!img.ok) return new Response(null, { status: 404 });
    const bytes = await img.arrayBuffer();
    return new Response(bytes, {
      headers: {
        'Content-Type': img.headers.get('content-type') || 'image/png',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
