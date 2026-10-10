'use client';

import * as React from 'react';

/**
 * Kisi pane ko theek utni height deta hai ki uska neecha wahan khatam ho jahan asli dikhne
 * wali screen khatam hoti hai — uske neeche jo kuch rehna chahiye (jaise page ka footer)
 * uski jagah chhod kar.
 *
 * KYUN JS — CSS kaafi kyun nahi. Do alag wajahein:
 *
 * 1. KEYBOARD. `100dvh` browser ka address bar to sambhal leta hai, par phone ka keyboard
 *    nahi. iOS Safari me keyboard khulne par layout viewport bilkul waisa hi rehta hai;
 *    sirf "visual viewport" (jo hissa sach me dikh raha hai) chhota hota hai. Isliye
 *    `dvh`/`vh` par bana pane keyboard ke PEECHHE chala jaata hai aur composer dikhta hi
 *    nahi. `window.visualViewport` hi wo ek jagah hai jo sach bolti hai.
 *
 * 2. UPAR-NEECHE KA CHROME. `100dvh − <koi nap-tol>` likhna hamesha galat nikalta hai:
 *    topbar, shortcut bar, page header aur footer har screen par alag jagah lete hain, aur
 *    breakpoint badalte hi dikhte-chhupte hain. Ek bhi pixel ka farak page ko scroll karwa
 *    deta hai, aur sabse neeche ki cheez (chat me composer) fold ke neeche kat jaati hai.
 *    Isliye yahan naapa jaata hai, maana nahi: element ka apna top padha jaata hai, aur
 *    `reserve` se poochha jaata hai ki neeche kitni jagah chhodni hai.
 *
 * Hisaab: pane ka neecha = visual viewport ka neecha − reserve
 *   height = (vv.offsetTop + vv.height) − element ka top − reserve
 * `offsetTop` isliye ki keyboard khulne par iOS poore page ko upar khiska deta hai. Ye
 * formula page scroll hone par bhi sahi rehta hai, kyunki `getBoundingClientRect().top` me
 * scroll pehle se shaamil hota hai.
 *
 * Measure sirf events par hota hai (layout badalne par nahi), isliye "height set karo →
 * layout hile → phir se height set karo" wala loop ban hi nahi sakta.
 *
 * @param {object}   opts
 * @param {number}   opts.min      Isse chhoti height kabhi nahi di jaayegi.
 * @param {Function} opts.reserve  (el) => px — pane ke NEECHE kitni jagah chhodni hai.
 *                                 Layout ki jaankari page ki hai, hook ki nahi.
 */
export function useViewportFill({ min = 260, reserve } = {}) {
  const ref = React.useRef(null);
  // Har render par naya function aata hai; effect ko usse dobara nahi chalna chahiye.
  const reserveRef = React.useRef(reserve);
  reserveRef.current = reserve;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const vv = window.visualViewport;
    let raf = 0;

    const apply = () => {
      raf = 0;
      // Yahan pehle `el.style.height = ''` tha — "naapne se pehle apni height hata do".
      // Wo soch galat thi aur iPhone par screen kaanpne lagti thi: `reserve` neeche wali
      // cheezon ki HEIGHT naapta hai, aur height is baat se nahi badalti ki wo cheez fold
      // ke neeche chali gayi hai. Clear ki zaroorat thi hi nahi — par usse har naap par
      // pane ek pal ke liye apni poori CSS height par chala jaata tha. iOS par keyboard
      // khulte waqt visualViewport ke event darjanon baar chalte hain, to ye upar-neeche
      // upar-neeche dikhta tha.
      const below = reserveRef.current ? Math.max(0, reserveRef.current(el) || 0) : 0;
      // `Math.max(0, …)`: agar page kisi wajah se scroll ho gaya (iOS keyboard khulte waqt
      // focus wale input ko dikhane ke liye khud karta hai) to `top` rinaatmak ho jaata hai
      // aur pane utna hi bada ban jaata — jisse page aur scroll hota aur pane phir bada.
      // Yahan us chakkar ko kaat diya.
      const top = Math.max(0, el.getBoundingClientRect().top);
      const vh = vv ? vv.height : window.innerHeight;
      const shift = vv ? vv.offsetTop : 0;
      // floor, round nahi: aadha pixel bhi upar gaya to page scroll karne lagta hai (1280x700
      // par theek yahi 1px ka scroll dikha tha). Neeche ki taraf galti karna bilkul muft hai.
      const next = `${Math.max(min, Math.floor(vh + shift - top - below))}px`;
      // Wahi value dobara likhne par bhi browser layout dobara banata hai. Keyboard khulte
      // waqt ye handler bar-bar chalta hai, isliye bina badlav wali likhai yahin rok di.
      if (el.style.height !== next) el.style.height = next;
    };

    // Keyboard ek frame me nahi khulta — rAF par baandhne se har intermediate size par ek
    // hi naap hoti hai, aur pane keyboard ke saath chikna upar aata hai.
    const schedule = () => { if (!raf) raf = window.requestAnimationFrame(apply); };

    apply();
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      el.style.height = '';
    };
  }, [min]);

  return ref;
}
