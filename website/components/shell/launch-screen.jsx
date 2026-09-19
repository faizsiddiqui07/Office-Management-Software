'use client';

import { PRODUCT_NAME } from './brand';

/**
 * The screen shown while /bootstrap is on its way — a twin of the iOS launch image
 * (scripts/gen-ios-splash.py), so opening the installed app reads as ONE logo screen that
 * turns into the dashboard, not splash → white → spinner → dashboard.
 *
 * Geometry is the generator's rule, expressed in two CSS variables:
 *   --H  full screen height, --S  the shorter screen side.
 *   tile: 0.28·S wide, centre at 0.44·H; wordmark 0.42·S wide, 0.075·S below the tile;
 *   caption bottom at 0.93·H, 0.028·S tall.
 * By default --H/--S are the viewport (100dvh / 100vmin). In the installed iOS app the web
 * view starts BELOW the status bar (statusBarStyle 'default'), so the PNG's 0.44·H and the
 * viewport's 0.44·H are not the same pixel: the inline script in app/layout.jsx sets
 * --ls-h / --ls-s from `screen` and --ls-off to the bar's height before first paint, and
 * everything here subtracts --OFF.
 * Backgrounds are viewport.themeColor in app/layout.jsx — the colour painted before anything.
 *
 * Shown everywhere. On Android, Chrome draws its own splash first (manifest: icon + name on
 * background_color) and it cannot be turned off — so the manifest's background_color is
 * this screen's dark bg and the icon/name sit roughly where the tile/wordmark do, and the
 * hand-off reads as one screen settling into place. Off iOS, --S is capped at 640px
 * (globals.css) so a desktop window doesn't get a 300px tile.
 *
 * Theme: the PNG follows the SYSTEM appearance (iOS picks it by prefers-color-scheme); this
 * screen follows the app's own `.dark` class like everything else. For the few people who
 * forced a theme opposite to their phone's, the colour flips here instead of at the
 * dashboard — inherent, not a bug.
 *
 * Covers the aurora/wallpaper (fixed, on top) on purpose: the splash is flat, so this is
 * flat too; the wallpaper appears with the dashboard.
 */
export function LaunchScreen() {
  return (
    <div
      role="status"
      aria-label={`Loading ${PRODUCT_NAME}`}
      className="launch-screen fixed inset-0 z-50 bg-[#f7f8fc] dark:bg-[#0c0e16] [--H:var(--ls-h,100dvh)] [--S:var(--ls-s,100vmin)] [--OFF:var(--ls-off,0px)]"
    >
      {/* App-icon tile: the home-screen icon, grown. Corners 22%, like the PNG. */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-[22%] bg-white bg-[url('/brand/launch-tile.png')] bg-cover shadow-[0_calc(0.011*var(--S))_calc(0.028*var(--S))_calc(-0.005*var(--S))_rgba(20,24,40,0.18)] ring-1 ring-[#e2e5ee] dark:shadow-none dark:ring-0"
        style={{
          top: 'calc(0.44 * var(--H) - 0.14 * var(--S) - var(--OFF))',
          width: 'calc(0.28 * var(--S))',
          height: 'calc(0.28 * var(--S))',
        }}
      />

      {/* Wordmark: only the theme's file is fetched. Both are 800×163, from one lockup. */}
      <div
        role="img"
        aria-label={PRODUCT_NAME}
        className="absolute left-1/2 -translate-x-1/2 bg-contain bg-center bg-no-repeat bg-[url('/brand/wordmark-light.png')] dark:bg-[url('/brand/wordmark-dark.png')]"
        style={{
          top: 'calc(0.44 * var(--H) + 0.215 * var(--S) - var(--OFF))',
          width: 'calc(0.42 * var(--S))',
          aspectRatio: '800 / 163',
        }}
      />

      {/* Caption: its bottom edge on the PNG's 0.93·H line. The web view's bottom is the
          screen's bottom, so no --OFF here. */}
      <p
        className="absolute inset-x-0 text-center leading-none text-[#6e7487] dark:text-[#8c92a5]"
        style={{ bottom: 'calc(0.07 * var(--H))', fontSize: 'calc(0.028 * var(--S))' }}
      >
        A product of BrainQbit
      </p>

      {/* Three pulsing dots UNDER the caption — the one thing a static launch image can't
          do: say "working". Hidden for reduced-motion; kept alive in Lite mode (globals.css). */}
      <span
        className="launch-dots absolute inset-x-0 flex justify-center gap-[calc(0.012*var(--S))] motion-reduce:hidden"
        style={{ bottom: 'calc(0.07 * var(--H) - 0.032 * var(--S))' }}
        aria-hidden
      >
        <i className="size-[calc(0.012*var(--S))] animate-pulse rounded-full bg-[#6e7487] opacity-60 dark:bg-[#8c92a5]" />
        <i className="size-[calc(0.012*var(--S))] animate-pulse rounded-full bg-[#6e7487] opacity-60 [animation-delay:200ms] dark:bg-[#8c92a5]" />
        <i className="size-[calc(0.012*var(--S))] animate-pulse rounded-full bg-[#6e7487] opacity-60 [animation-delay:400ms] dark:bg-[#8c92a5]" />
      </span>
    </div>
  );
}
