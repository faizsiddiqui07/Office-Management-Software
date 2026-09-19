'use client';

import * as React from 'react';
import { useAuth } from '@/lib/auth';
import { PRODUCT_NAME } from './brand';

/**
 * The desktop/laptop preloader — the branded first two seconds of every full page load.
 *
 * Phones and tablets already have theirs: iOS gets the launch image + LaunchScreen, Android
 * gets Chrome's manifest splash. Desktop had nothing but a spinner, so this is that gap:
 * the ManagiBot tile and wordmark ease in, a thin line fills, and the whole thing crossfades
 * into the app. Only where there is a mouse — `(hover: hover) and (pointer: fine)` — and never
 * on iOS (globals.css does the gating, so it costs phones nothing).
 *
 * Timing:
 *   • It is in the server HTML, so it is on screen from the very first paint (no flash of
 *     the page before it). The entrance animations are pure CSS and start with that paint.
 *   • It stays at least MIN_MS from first paint — long enough for /bootstrap and the
 *     dashboard to render UNDERNEATH it, which is the point: when it lifts, the app is
 *     already there, not a spinner. If loading takes longer, it waits (the line sits at 92%).
 *   • Never past MAX_MS: a dead API must not hide behind a logo — the app's own error and
 *     retry handling has to become visible.
 *   • Exit = the line snaps to 100%, then a 600 ms crossfade (opacity only, compositor
 *     work — nothing that can stutter). Then it unmounts.
 *
 * It lives in the ROOT layout, so it runs exactly once per full load — including a signed-
 * out load that lands on /login — and never again on client-side navigation.
 */
const MIN_MS = 2000;
const MAX_MS = 6000;
const EXIT_MS = 600;

/** When the page first painted — the clock MIN_MS/MAX_MS run from. If the browser hasn't
 *  recorded a paint entry yet (or can't), "now" is the honest fallback: we are running
 *  right after hydration, which is at or just after first paint. Not 0 — that would count
 *  the time the HTML took to arrive as "already shown". */
function firstPaintMs() {
  try {
    const p = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint');
    if (p && p.startTime > 0) return p.startTime;
  } catch {
    /* fall through */
  }
  return performance.now();
}

export function DesktopPreloader() {
  const { isLoading } = useAuth();
  // 'show' → 'exit' (crossfade running) → 'done' (gone). The server renders 'show'.
  const [phase, setPhase] = React.useState('show');
  const desktopRef = React.useRef(true);
  const rootRef = React.useRef(null);

  // Not a desktop (or iOS, which has its own launch screen): CSS already hides it — just
  // don't run timers for it.
  React.useEffect(() => {
    let desktop = false;
    try {
      desktop = matchMedia('(hover: hover) and (pointer: fine)').matches && document.documentElement.dataset.ios !== 'true';
    } catch {
      desktop = false;
    }
    desktopRef.current = desktop;
    if (!desktop) setPhase('done');
  }, []);

  React.useEffect(() => {
    if (phase !== 'show' || !desktopRef.current) return undefined;
    const start = firstPaintMs();
    const now = performance.now();
    const hardCap = setTimeout(() => setPhase('exit'), Math.max(0, start + MAX_MS - now));
    let ready;
    if (!isLoading) ready = setTimeout(() => setPhase('exit'), Math.max(0, start + MIN_MS - now));
    return () => {
      clearTimeout(hardCap);
      clearTimeout(ready);
    };
  }, [phase, isLoading]);

  // While the sheet is up, the page underneath must not take keyboard focus (Tab reached
  // the login form's controls through it, and Enter submitted) nor be read by a screen
  // reader — `inert` on every sibling does both. Lifted on exit; whatever had focus before
  // (the login page autofocuses its email field) gets it back.
  React.useEffect(() => {
    if (phase !== 'show' || !desktopRef.current) return undefined;
    const root = rootRef.current;
    const prevFocus = document.activeElement;
    const siblings = Array.from(document.body.children).filter((el) => el !== root && el.tagName !== 'SCRIPT');
    siblings.forEach((el) => { el.inert = true; });
    return () => {
      siblings.forEach((el) => { el.inert = false; });
      if (prevFocus && prevFocus !== document.body && prevFocus.isConnected) {
        try { prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
    };
  }, [phase]);

  React.useEffect(() => {
    if (phase !== 'exit') return undefined;
    const t = setTimeout(() => setPhase('done'), EXIT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === 'done') return null;

  return (
    <div
      ref={rootRef}
      className="desktop-preloader fixed inset-0 z-[100] bg-[#f7f8fc] dark:bg-[#0c0e16]"
      data-phase={phase}
      role="status"
      aria-label={`Loading ${PRODUCT_NAME}`}
      aria-busy={phase === 'show'}
    >
      <div className="preloader-stage absolute inset-0 flex flex-col items-center justify-center">
        {/* App-icon tile — the same tile as the iOS launch image, so the brand reads the
            same on every device. */}
        <div className="preloader-tile size-[148px] rounded-[22%] bg-white bg-[url('/brand/launch-tile.png')] bg-cover shadow-[0_10px_30px_-8px_rgba(20,24,40,0.22)] ring-1 ring-[#e2e5ee] dark:shadow-none dark:ring-0" />
        <div
          role="img"
          aria-label={PRODUCT_NAME}
          className="preloader-wordmark mt-9 aspect-[800/163] w-[236px] bg-[url('/brand/wordmark-light.png')] bg-contain bg-center bg-no-repeat dark:bg-[url('/brand/wordmark-dark.png')]"
        />
        {/* Progress line: fills to 92% over the two seconds, 100% the moment we leave. */}
        <div className="preloader-track mt-9 h-[3px] w-[168px] overflow-hidden rounded-full bg-[#e2e5ee] dark:bg-[#1c2030]">
          <div className="preloader-bar h-full w-full origin-left rounded-full bg-gradient-to-r from-[#0b2a5b] to-[#4a7fc1] dark:from-[#5b8fd6] dark:to-[#8fb6ee]" />
        </div>
      </div>
      <p className="preloader-caption absolute inset-x-0 bottom-[7%] text-center text-[13px] leading-none text-[#6e7487] dark:text-[#8c92a5]">
        A product of BrainQbit
      </p>
    </div>
  );
}
