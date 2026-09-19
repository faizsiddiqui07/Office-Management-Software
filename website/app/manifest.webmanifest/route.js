/**
 * The web app manifest — /manifest.webmanifest
 *
 * Icons: HAMESHA ManagiBot ke — `public/brand/` se, code me. Pehle ye Settings se upload
 * kiye hue icon ko naap kar declare karta tha (browser ka niyam: manifest ka `sizes` asli
 * pixel se match ho, warna icon reject aur app install hi nahi hoti). Ab icon fixed hain
 * aur unke size pakke — isliye wo sab naapne-taulne ka kaam gaya.
 *
 * Naam/short_name pehle jaise hi hain (badalna alag faisla hai).
 */
export const dynamic = 'force-static';

const ICONS = [
  { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  // Alag maskable entry — Android launcher apne shape me kaat-ta hai (icon beech ke 72%
  // me hai, safe zone). Sirf-maskable wali entry installability ke liye kaafi nahi hoti,
  // isliye `any` wali upar alag hai.
  { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

export function GET() {
  const manifest = {
    name: 'Architectus Bureau',
    id: '/dashboard',
    short_name: 'Architectus',
    description: 'Attendance, leaves, dues, expenses and more — your office in one place.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#0b0f1a',
    icons: ICONS,
  };
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
