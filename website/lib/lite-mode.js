'use client';

import * as React from 'react';

export const LITE_KEY = 'om_lite_ui';

/**
 * "Lite UI" — drops the frosted-glass blur, the animated background and the
 * heavier shadows so the app stays smooth on an older phone.
 *
 * It's a per-DEVICE choice, so it lives in localStorage rather than on the
 * account: the same person should still get the full look on a laptop that can
 * handle it. There is deliberately NO auto-detection — guessing a phone's
 * capability is unreliable and would flip people between two looks for no
 * visible reason. The switch lives in Profile → Appearance.
 *
 * The attribute itself is set before first paint by a small script in the root
 * layout, so the app never flashes the heavy UI first.
 */
/**
 * Lite abhi ON hai ya nahi — ek line me, bina hook ke.
 *
 * `data-lite` pehle paint se PEHLE hi lag chuka hota hai (app/layout.jsx ka inline
 * script), isliye padhne ko hamesha taiyaar hai. Par ise seedha render me mat padhna:
 * server par `document` hai hi nahi, aur client ka pehla render server se mel khana
 * chahiye — warna hydration mismatch. Effect ke andar, ya un component me jo
 * `dynamic(..., { ssr: false })` se aate hain, surakshit hai.
 */
export const liteOn = () => typeof document !== 'undefined' && document.documentElement.dataset.lite === 'true';

/**
 * "SHAANT RAHO" — JS se chalne wali animation ke liye Lite aur reduce-motion ek saath.
 *
 * KYUN BANANA PADA (owner, 28 Nov 2026): Lite ek aisi pasand hai jise CSS to padh leta
 * hai (`:root[data-lite='true']`) par JavaScript bilkul nahi. `prefers-reduced-motion` ko
 * dono padh lete hain — CSS ki media query, framer ka `useReducedMotion()`, recharts ka
 * apna hisaab. Nateeja ye tha ki reduce-motion wala banda har jagah dhaka hua tha aur
 * Lite wala SIRF CSS ke andar: dashboard ke chart Lite me bhi poore 1.5 second animate
 * karte the, aur har StatCard 450ms me upar uthti thi — theek us phone par jiske liye
 * Lite banaya gaya tha.
 *
 * DONO EK CHEEZ NAHI HAIN, aur inhe ek flag mat samajhna:
 *   lite   = "mera phone kamzor hai"  → SAJAWAT band, par jo motion kuch BATATI hai
 *            (spinner, progress patti) wo zinda rehti hai — bas sasti shakal me.
 *   reduce = "mujhe hilti cheezein nahi chahiye" → sab band, batane wali bhi; baat
 *            shabdon se kahi jaayegi ("3s", "28:14", "42%").
 *   still  = sirf SAJAWAT band karne ke liye (dono ko sajawat nahi chahiye).
 *
 * Isliye informative motion par `lite` aur `reduce` ALAG-ALAG poochho, aur sajawat par
 * `still`. Yahi baat globals.css ke ".tick-bar" wale hisse me CSS ki taraf se likhi hai.
 */
export function useCalm() {
  const [lite, setLite] = React.useState(false);
  const [reduce, setReduce] = React.useState(false);

  React.useEffect(() => {
    setLite(liteOn());
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return { lite, reduce, still: lite || reduce };
}

export function useLiteMode() {
  const [lite, setLite] = React.useState(false);

  // Read what the pre-paint script already applied (avoids a hydration mismatch).
  React.useEffect(() => {
    setLite(document.documentElement.dataset.lite === 'true');
  }, []);

  const setLiteMode = React.useCallback((on) => {
    if (typeof document !== 'undefined') {
      if (on) document.documentElement.dataset.lite = 'true';
      else delete document.documentElement.dataset.lite;
    }
    try {
      window.localStorage.setItem(LITE_KEY, on ? '1' : '0');
    } catch {
      // Storage blocked (private mode) — the switch still applies for this session.
    }
    setLite(on);
  }, []);

  return { lite, setLiteMode };
}
