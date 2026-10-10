'use client';

import * as React from 'react';

/**
 * Kisi pane ko "yahan se screen ke neeche tak" wali ASLI height deta hai.
 *
 * KYUN JS — CSS kaafi kyun nahi. `100dvh` browser ka address bar sambhal leta hai, par
 * phone ka KEYBOARD nahi. iOS Safari me keyboard khulne par layout viewport bilkul waisa
 * hi rehta hai; sirf "visual viewport" (jo hissa sach me dikh raha hai) chhota hota hai.
 * Isliye `dvh`/`vh` par banaya hua pane keyboard ke PEECHHE chala jaata hai aur composer
 * dikhta hi nahi. `window.visualViewport` hi wo ek jagah hai jo sach bolti hai, aur wahi
 * yahan padhi ja rahi hai. Android Chrome bhi isi ko sahi batata hai, to ek hi raasta
 * dono par chalta hai.
 *
 * Hisaab: pane ka neecha = visual viewport ka neecha.
 *   height = (vv.offsetTop + vv.height) − element ka top
 * `offsetTop` isliye ki keyboard khulne par iOS poore page ko upar khiska deta hai.
 * Ye formula page scroll hone par bhi sahi rehta hai, kyunki `getBoundingClientRect().top`
 * me scroll pehle se shaamil hota hai.
 *
 * `query` se ye SIRF chhoti screen par lagta hai. Usse badi screen par inline height hata
 * di jaati hai, taaki wahan normal Tailwind classes hi chalein aur desktop ka layout
 * bilkul na badle.
 *
 * Measure sirf events par hota hai (layout badalne par nahi), isliye "height set karo →
 * layout hile → phir se height set karo" wala loop ban hi nahi sakta.
 */
export function useViewportFill({ query = '(max-width: 639px)', min = 240 } = {}) {
  const ref = React.useRef(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const mq = window.matchMedia(query);
    const vv = window.visualViewport;
    let raf = 0;

    const clear = () => { el.style.height = ''; };

    const apply = () => {
      raf = 0;
      if (!mq.matches) { clear(); return; }
      const top = el.getBoundingClientRect().top;
      const vh = vv ? vv.height : window.innerHeight;
      const shift = vv ? vv.offsetTop : 0;
      el.style.height = `${Math.max(min, Math.round(vh + shift - top))}px`;
    };

    // Keyboard ek frame me nahi khulta — rAF par baandhne se har intermediate size par
    // ek hi naap hoti hai, aur pane keyboard ke saath chikna upar aata hai.
    const schedule = () => { if (!raf) raf = window.requestAnimationFrame(apply); };

    apply();
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    mq.addEventListener('change', schedule);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      mq.removeEventListener('change', schedule);
      clear();
    };
  }, [query, min]);

  return ref;
}
