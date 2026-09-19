/**
 * /app-icon — ab sirf ManagiBot ke static icon par bhejta hai.
 *
 * Pehle ye route Settings se upload kiya hua app icon S3 se stream karta tha. Owner ka
 * faisla: app icon PRODUCT (ManagiBot) ka hai, client ka nahi — Settings se kabhi nahi
 * badlega. Isliye icon ab `public/brand/` me code ke saath hai, aur ye route sirf
 * isliye zinda hai ki pehle se install kiye hue PWA aur cached favicon jo `/app-icon`
 * maangte hain, wo toote nahi — unhe naye icon par bhej diya jaata hai.
 */
export const dynamic = 'force-static';

export function GET() {
  return new Response(null, {
    status: 308,
    headers: {
      Location: '/brand/icon-512.png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
