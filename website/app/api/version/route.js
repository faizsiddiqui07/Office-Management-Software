/**
 * Reports the build currently deployed. The value is baked in at build time, so after
 * a new deploy this route answers with the new stamp while already-open apps are still
 * carrying the old one — which is exactly how they notice an update is waiting.
 *
 * Never cached: a cached answer here would defeat the whole point.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID || 'dev' },
    { headers: { 'Cache-Control': 'no-store, must-revalidate' } },
  );
}
