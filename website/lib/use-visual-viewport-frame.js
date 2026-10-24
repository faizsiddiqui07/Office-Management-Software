'use client';

import * as React from 'react';

/** Isi chaudai se neeche "phone" — Tailwind ke `sm` (640px) se ek pixel kam. */
const PHONE = '(max-width: 639.98px)';
/**
 * Dabba isse chhota nahi banta. Topbar 72px + chat header ~57px + composer ~57px — isse kam
 * me composer card ke andar kat jaata (overflow-hidden). Aisa sirf bahut chhoti landscape
 * screen par keyboard khule hone par hota hai (iPhone SE landscape: dikhne wali jagah
 * ~60-110px). Tab dabba 260px ka hi rehta hai aur UPAR khisak jaata hai, taaki NEECHE
 * (composer) dikhne wale hisse ke theek upar bana rahe — topbar kurbaan, likhna nahi.
 */
const MIN_HEIGHT = 260;

/**
 * Phone par ek dabbe ko theek utna bada aur wahin rakhna jitna aur jahan screen par sach
 * me DIKH raha hai — upar AUR neeche dono taraf se. Chat page ke liye (owner, 24 Oct 2026).
 *
 * DIKKAT jo isse theek hoti hai — iPhone par chat karte waqt "poora page khisakna":
 *
 * iPhone par keyboard khulne se LAYOUT viewport (jis par page bana hai) chhota nahi hota.
 * Sirf wo hissa chhota hota hai jo dikhta hai (visual viewport), aur iOS us dikhne wale
 * hisse ko page ke andar neeche khiska (pan) deta hai taaki textarea keyboard ke upar aaye
 * — `visualViewport.offsetTop` 0 se ~340px tak. Pehle chat pane `useViewportFill` se sirf
 * NEECHE ka hissa pakadta tha: composer keyboard ke upar rehta, par jitna iOS pan karta,
 * utna hi topbar aur chat header nazar se upar bahar chale jaate. Browser me naapa gaya:
 * pan 120 → topbar 120px upar gayab, pan 342 → 342px. Har naye message/keyboard ki harkat
 * par iOS dobara pan karta, aur page jhatke se hilta.
 *
 * Yahan dabba (topbar + chat ka poora stack) `position: fixed` hai, uski height =
 * visual viewport ki height, aur `top` = `offsetTop`. iOS jitna bhi pan kare, dabba saath
 * chalta hai — topbar hamesha dikhne wale hisse ke upar, composer theek keyboard ke upar.
 * Andar ka layout seedha CSS flex se bharta hai, koi naap-tol nahi.
 *
 * `transform: translateY` NAHI, `top` — jaan-boojhkar. Transform apne andar ke
 * `position: fixed` bachchon ka "containing block" ban jaata hai (chat ka photo viewer
 * `fixed inset-0` hai) — wahi dikkat jiski chetawani components/chat/chat-fab.jsx me
 * likhi hai. `position: fixed` khud aisa nahi karta. `top` badalne se layout dobara banta
 * hai, par wo sirf pan hone par hota hai, har frame par nahi.
 *
 * Jab tak dabba chaalu hai, <html> par `chat-pane` class lagti hai — globals.css usse
 * document ka scroll band kar deta hai, taaki dabbe ke peeche hilne layak kuch bache hi na.
 *
 * SEEMA (jaan-boojhkar): sirf 640px se kam chaudai par. Phone landscape (jaise 844px),
 * iPad aur khule foldable par chat ek "page" jaisa layout hai — page header, footer — aur
 * wahan purana `useViewportFill` hi chalta hai, yaani wahan keyboard ke pan par topbar ab
 * bhi upar khisak sakta hai. Owner ki shikayat portrait phone ki thi; tablet par us page
 * layout ko bhi dabbe me badalna alag design ka faisla hai.
 *
 * CALLBACK REF lautata hai, `useRef` nahi — jaan-boojhkar. AppShell loading ke dauraan
 * jaldi `return` kar deta hai, us waqt dabba DOM me hota hi nahi. `useRef` wala effect
 * pehli baar null dekh kar chup baith jaata aur dabba aane par dobara chalta hi nahi
 * (yahi galti Buddy ke panel me ho chuki hai). Callback ref se dabba jab bhi juda, effect
 * usi pal chalta hai.
 *
 * @param {boolean} enabled  Sirf jis route par chahiye (AppShell chat par chaalu karta hai).
 * @param {object}  [opts]
 * @param {'fixed'|'relative'} [opts.position='fixed']
 *        'fixed' — dabba khud screen se bandha (AppShell ka chat stack).
 *        'relative' — dabba apne parent ke andar utna hi neeche khiskta hai jitna iOS ne
 *        pan kiya (Buddy ka column: uska Sheet pehle se `fixed inset-y-0` hai, to column
 *        ko bas usi ke andar dikhne wale hisse par le aana hai).
 * @param {string|null} [opts.media=PHONE]  Sirf is media query par. null = hamesha.
 * @param {string|null} [opts.lockClass='chat-pane']  Chaalu rehte <html> par lagne wali
 *        class (globals.css document ka scroll band karta hai). null = koi class nahi.
 * @returns {(node: HTMLElement|null) => void}  dabbe par `ref={...}` lagao
 */
export function useVisualViewportFrame(enabled, { position = 'fixed', media = PHONE, lockClass = 'chat-pane' } = {}) {
  const [el, setEl] = React.useState(null);

  React.useLayoutEffect(() => {
    if (!enabled || !el) return undefined;

    const mq = media ? window.matchMedia(media) : null;
    const vv = window.visualViewport;
    const root = document.documentElement;
    let raf = 0;
    let on = false;

    const off = () => {
      if (!on) return;
      on = false;
      el.style.removeProperty('position');
      el.style.removeProperty('top');
      el.style.removeProperty('left');
      el.style.removeProperty('right');
      el.style.removeProperty('height');
      if (lockClass) root.classList.remove(lockClass);
    };

    const apply = () => {
      raf = 0;
      if (mq && !mq.matches) { off(); return; }
      if (!on) {
        on = true;
        if (lockClass) {
          root.classList.add(lockClass);
          // Pichhle page se aaya scroll bacha ho to wo yahan ka layout khiska deta.
          if (window.scrollY) window.scrollTo(0, 0);
        }
      }
      const vh = Math.floor(vv ? vv.height : window.innerHeight);
      const t = vv ? Math.max(0, vv.offsetTop) : 0;
      const h = Math.max(vh, MIN_HEIGHT);
      // Normal phone par h === vh, to top === offsetTop. Jagah kam ho to dabba (h − vh) upar.
      const top = Math.round(t) + vh - h;
      el.style.position = position;
      if (position === 'fixed') {
        el.style.left = '0px';
        el.style.right = '0px';
      }
      el.style.top = `${top}px`;
      el.style.height = `${h}px`;
    };

    // Keyboard ek frame me nahi khulta — rAF par baandho, har beech ki size par ek hi naap.
    const schedule = () => { if (!raf) raf = window.requestAnimationFrame(apply); };

    apply();
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    mq?.addEventListener?.('change', schedule);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      mq?.removeEventListener?.('change', schedule);
      off();
    };
  }, [enabled, el, position, media, lockClass]);

  return setEl;
}
