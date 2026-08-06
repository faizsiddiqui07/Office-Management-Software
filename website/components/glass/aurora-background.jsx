/**
 * Ambient background behind the glass content layer — a warm, photographic CSS
 * ambient (aurora blobs + soft warm wash), so the app always looks premium with
 * NO image asset at all. Photo backgrounds are uploaded through Settings and live
 * in S3 (see AppBackground); nothing image-like ships with the frontend build.
 *
 * Pure CSS (no JS) → renders on the server; respects prefers-reduced-motion via
 * the global media query in globals.css.
 */
export function AuroraBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* base wash */}
      <div className="absolute inset-0 bg-background" />

      {/* warm ambient bloom (top-left light, like a sunlit window) */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 18% 12%, color-mix(in oklch, #f5b677 35%, transparent), transparent 70%)',
        }}
      />

      {/* aurora blobs */}
      <div
        className="aurora-blob animate-aurora"
        style={{
          top: '-12%',
          left: '-8%',
          width: '46vw',
          height: '46vw',
          background:
            'radial-gradient(circle at 30% 30%, color-mix(in oklch, var(--primary) 65%, transparent), transparent 60%)',
        }}
      />
      <div
        className="aurora-blob animate-aurora"
        style={{
          top: '-6%',
          right: '-10%',
          width: '40vw',
          height: '40vw',
          animationDelay: '-7s',
          background:
            'radial-gradient(circle at 60% 40%, color-mix(in oklch, var(--info) 60%, transparent), transparent 60%)',
        }}
      />
      <div
        className="aurora-blob animate-aurora"
        style={{
          bottom: '-20%',
          left: '24%',
          width: '46vw',
          height: '46vw',
          animationDelay: '-14s',
          background:
            'radial-gradient(circle at 50% 50%, color-mix(in oklch, #e09b5a 45%, transparent), transparent 62%)',
        }}
      />

      {/* fine grid + vignette for depth */}
      <div
        className="absolute inset-0 opacity-[0.16] dark:opacity-[0.1]"
        style={{
          backgroundImage:
            'linear-gradient(to right, color-mix(in oklch, var(--foreground) 100%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklch, var(--foreground) 100%, transparent) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 75%)',
        }}
      />

      {/* soften everything into a frosted wash + corner vignette */}
      <div className="absolute inset-0 backdrop-blur-[60px]" />
      <div className="absolute inset-0 bg-background/20" />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 120% at 50% 50%, transparent 55%, color-mix(in oklch, var(--background) 70%, transparent) 100%)',
        }}
      />
    </div>
  );
}
