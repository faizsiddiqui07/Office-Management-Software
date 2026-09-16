'use client';

import * as React from 'react';
import { Share, X } from 'lucide-react';

/**
 * iPhone/iPad walon ke liye ek baar ka hint.
 *
 * Apple par web notification SIRF tab aata hai jab app ko Safari se "Add to Home Screen"
 * kiya gaya ho (iOS 16.4+). Sirf Safari ke tab me kholne wale iPhone users ko chat ka
 * notification KABHI nahi milega — aur unhe ye kabhi pata nahi chalega, kyunki na koi
 * error aata hai na permission ka prompt.
 *
 * Isliye ye card sirf wahan dikhta hai jahan sach me zaroorat hai: iPhone/iPad, aur app
 * abhi install nahi hai. Ek baar hata diya to dobara nahi aata (uska nishaan browser me
 * hi rehta hai, server par nahi — ye har device ki apni baat hai).
 *
 * Android aur laptop par normal tab me sab theek chalta hai, isliye wahan ye kuch nahi
 * dikhata.
 */
const DISMISS_KEY = 'om_chat_ios_hint_dismissed';

function isIosNotInstalled() {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  // iPad ab khud ko Mac batata hai — touch points se pehchan hoti hai.
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  const installed =
    window.navigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)')?.matches === true;
  return !installed;
}

export function IosPushHint() {
  const [show, setShow] = React.useState(false);

  // Server par ye sab nahi chalta, isliye pehle render ke BAAD jaancho — warna server
  // aur browser ka HTML alag ho jaata hai (hydration error).
  React.useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      // private window / site data band — hint dikha dena hi theek hai
    }
    if (!dismissed && isIosNotInstalled()) setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // yaad na rakh paaye to agli baar phir dikhega — koi nuksan nahi
    }
  };

  return (
    <div className="mx-2 mb-2 flex items-start gap-2.5 rounded-lg border border-primary/25 bg-primary/[0.07] px-3 py-2.5">
      <Share className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">iPhone par notification chaalu karein</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          Safari me neeche <b>Share</b> dabaayein → <b>Add to Home Screen</b>. Uske baad hi naye
          message ka notification aayega.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="-mr-1 -mt-1 shrink-0 rounded-full p-1 text-muted-foreground hover:bg-foreground/10"
        aria-label="Hata dein"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
