'use client';

import * as React from 'react';

/**
 * Buddy ka chehra — owner ka diya hua Lottie blob.
 *
 * Naap kar liye gaye faisle (23–24 Oct, browser me chala kar):
 *
 * 1. **SVG renderer hi.** Is file me 6 gaussian blur hain; canvas renderer unhe chhod
 *    deta hai aur blob chapte, kade kinaaron wale shapes ban jaata hai — bilkul bura.
 * 2. **JSON `/public` se**, `import` se nahi — warna 27 KB main bundle me ghus jaata.
 * 3. **lottie-web alag chunk me** (~70 KB gzip), `import()` se.
 * 4. **Button par wo chunk IDLE me aata hai, turant nahi.** Button har page par dikhta
 *    hai, to pehle ye har page load par 70 KB maang raha tha — aur iPhone ki slow-open
 *    wali samasya pehle se chal rahi hai (audits/15). Ab page ke theek hone ke baad,
 *    farsat me aata hai. Panel ke andar `eager` hai: wahan user ne khud khola hai.
 * 5. **Neeche hamesha ek CSS wala orb.** Lottie aane se pehle, Lite mode me, aur load
 *    fail hone par bhi button khaali nahi dikhta — wahi gulabi-neela gola, bina kisi
 *    kharche ke.
 *
 * Chhote size par Lottie ka kharcha naapne par dikha hi nahi (56px par p95 frame wahi
 * 33.6 ms jo bina blob ke tha). Par bada karke mat lagana — 200px wale saat instance ne
 * fps 28 par gira diya tha.
 */

/**
 * Lite mode chaalu hai ya nahi — seedha attribute se, `useLiteMode()` hook se nahi.
 *
 * Wo hook har instance me apni state aur apna effect banata hai, aur yahan ek saath
 * 2–4 blob render hote hain (button, header, khaali screen, "soch raha hoon"). Chaar
 * copies ek hi baat ki — bekaar. Attribute root layout ka script pehle paint se pehle
 * hi laga deta hai, to padhne ko hamesha taiyaar hai.
 *
 * Ek seema: mount hone ke BAAD agar koi Lite toggle kare to ye blob nahi badlega.
 * Theek hai — wo switch Profile page par hai, aur wahan se wapas aate hi blob dobara
 * mount hota hai.
 */
const liteOn = () => typeof document !== 'undefined' && document.documentElement.dataset.lite === 'true';

/** Jab browser farsat me ho. Safari me `requestIdleCallback` nahi hai — wahan timeout. */
function whenIdle(fn) {
  if (typeof window === 'undefined') return () => {};
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 1200);
  return () => window.clearTimeout(id);
}

export function BuddyBlob({ size = 44, playing = true, eager = false, className }) {
  const box = React.useRef(null);
  const anim = React.useRef(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    // Lite mode me Lottie laane ka koi matlab hi nahi — CSS wala orb hi dikhega.
    if (liteOn()) return undefined;
    let dead = false;
    let made = null;

    const load = async () => {
      const lottie = (await import('lottie-web')).default;
      if (dead || !box.current) return;
      made = lottie.loadAnimation({
        container: box.current,
        renderer: 'svg',
        loop: true,
        autoplay: false,
        path: '/buddy/blob.json',
      });
      anim.current = made;
      made.addEventListener('DOMLoaded', () => { if (!dead) setReady(true); });
    };

    const cancel = eager ? (load(), () => {}) : whenIdle(load);
    return () => {
      dead = true;
      cancel();
      made?.destroy();
      anim.current = null;
      setReady(false);
    };
  }, [eager]);

  React.useEffect(() => {
    const a = anim.current;
    if (!a || !ready) return undefined;
    const apply = () => {
      // Tab chhupi ho to chalane ka koi matlab nahi — sirf battery jalti hai.
      if (playing && !document.hidden) a.play();
      else a.goToAndStop(0, true);
    };
    apply();
    document.addEventListener('visibilitychange', apply);
    return () => document.removeEventListener('visibilitychange', apply);
  }, [playing, ready]);

  return (
    <span
      aria-hidden="true"
      className={className}
      style={{ width: size, height: size, display: 'block', position: 'relative' }}
    >
      {/* Hamesha maujood — Lottie isi ke upar aata hai. */}
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '9999px',
          background: 'radial-gradient(circle at 32% 30%, #ff5fa8 0%, #b06bff 45%, #4aa8ff 100%)',
          opacity: ready ? 0 : 1,
          transition: 'opacity 240ms ease',
        }}
      />
      <span ref={box} style={{ position: 'absolute', inset: 0 }} />
    </span>
  );
}
