'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';

/**
 * Theme badalne par ek chhota sa fade — jhatke me nahi, ghulte hue.
 *
 * Owner ka kehna (23 Nov 2026): toggle dabate hi rang EK DAM badal jaata tha; wo
 * dhire-dhire badalna chahiye.
 *
 * KYUN WO EK DAM THA: `next-themes` ko `disableTransitionOnChange` ke saath chalaya
 * gaya hai (providers/theme-provider.jsx). Wo theme badalte waqt `* { transition:
 * none !important }` ka ek style chipka deta hai, reflow karwata hai, phir hata deta
 * hai — yaani switch ko JAAN-BOOJH KAR instant banata hai. Us flag ko HATAYA NAHI
 * GAYA, aur wo soch-samajh kar: uske bina phone ka system theme apne aap badalne par
 * (shaam ko dark) sirf wo cheezein fade hoti jinpar pehle se `transition-colors` hai,
 * baaki snap — aadha-adhoora, aur bura dikhta.
 *
 * Iske bajaye yahan `<html>` par ek `theme-switching` class CHIPKAYI jaati hai, aur
 * globals.css me usi class ke liye ek zyada specific `!important` rule hai jo
 * next-themes wale rule ko haraata hai. Natija: fade SIRF tab hota hai jab banda khud
 * theme badalta hai, aur baaki har soorat me purana surakshit bartaav waisa hi rehta
 * hai.
 *
 * LITE MODE aur REDUCED MOTION dono apne aap chhoot jaate hain — kaise, wo globals.css
 * wale rule ki tippani me likha hai. Yahan JS me unki koi jaanch nahi, kyunki wo jaanch
 * do jagah rakhne par ek din dono alag ho jaati hain.
 */

/** Fade kitni der ka. globals.css wale rule me BHI yahi number hai — dono saath badlo. */
export const THEME_FADE_MS = 300;

export function useThemeTransition() {
  const ctx = useTheme();
  const { setTheme } = ctx;
  const timer = React.useRef(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const setThemeSmooth = React.useCallback(
    (next) => {
      const root = document.documentElement;
      root.classList.add('theme-switching');
      // Reflow — taaki browser PEHLE ye maan le ki transition chalu hai aur rang abhi
      // purane hain. Bina iske class aur rang ek hi recalc me badalte hain; spec ke
      // hisaab se tab bhi fade hona chahiye, par is ek line se wo "chahiye" nahi,
      // "hoga" ban jaata hai.
      void root.offsetHeight;
      setTheme(next);
      if (timer.current) clearTimeout(timer.current);
      // Thodi si fazool der jodi hai taaki class aakhri frame se pehle na hate —
      // warna fade ke aakhir me ek halka sa jhatka dikhta hai.
      timer.current = setTimeout(() => {
        root.classList.remove('theme-switching');
        timer.current = null;
      }, THEME_FADE_MS + 60);
    },
    [setTheme],
  );

  return { ...ctx, setThemeSmooth };
}
