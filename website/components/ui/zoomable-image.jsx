'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Tasveer jise app ke ANDAR zoom kiya ja sake — WhatsApp ke photo viewer jaisa.
 *
 * KYUN ZAROORI HAI: 24 Oct 2026 ko phone par poore app ka do-ungli zoom band kiya gaya
 * (owner ka faisla, dekho app/layout.jsx aur globals.css). Us din tak chat ki photo aur
 * attendance selfie ka chhota text log BROWSER ka zoom karke hi padhte the — inka apna
 * koi zoom tha hi nahi. Page zoom band karte hi wo raasta khatam ho jaata, isliye ye.
 *
 * Kya-kya chalta hai:
 *   - do ungli se pinch: 1x se 4x, dono ungliyon ke beech wale point ke gird
 *   - zoom ke baad ek ungli (ya mouse) se kheenchna, kinaron tak seemit
 *   - double-tap / double-click: 1x ↔ 2.5x, jahan tap kiya wahin ki taraf
 *   - desktop par mouse wheel se zoom, cursor ke gird
 *   - ek tap (sirf 1x par, aur ungli lagbhag hili na ho): `onTap` — viewer band karne ke liye
 *
 * Teen soche-samjhe faisle:
 *   1. POINTER events, gesture events NAHI. iPhone par layout.jsx ki script `gesturestart`
 *      ko rokti hai (page zoom ke liye). Agar ye component bhi gesture events par chalta
 *      to wahi rok ise bhi maar deti. Pointer events us se alag hain.
 *   2. Stage par `touch-none`. Isse browser saare touch JS ko de deta hai, aur ye
 *      utilities layer me hai — globals.css ka `touch-action: pan-x pan-y` (base layer)
 *      isse haar jaata hai. Bina iske browser pinch ko khud rok leta, hum tak aata hi nahi.
 *   3. Har harkat par React re-render nahi — transform seedha element par likha jaata hai
 *      (`ref`). 60 baar per second state badalna phone par atakta.
 *
 * Ek pinch ke baad ki pehli ungli uthne ko "tap" nahi maana jaata — warna zoom khatam
 * karte hi viewer band ho jaata. Ek baar single tap ~280ms ruk kar chalta hai, kyunki
 * pehle dekhna padta hai ki kahin doosra tap (double-tap) to nahi aa raha.
 */
const MIN = 1;
const MAX = 4;
const DOUBLE_TAP_SCALE = 2.5;
const TAP_GAP_MS = 280; // do tap ke beech itna waqt = double-tap
const TAP_SLOP_PX = 10; // isse zyada hili ungli = kheenchna, tap nahi
const TAP_MAX_MS = 400; // isse lamba dabana = tap nahi

export function ZoomableImage({ src, alt = '', onTap, className, imgClassName }) {
  const stageRef = React.useRef(null);
  const layerRef = React.useRef(null);
  const view = React.useRef({ s: 1, x: 0, y: 0 }); // abhi ka transform
  const pointers = React.useRef(new Map()); // ungliyan jo abhi screen par hain
  const gesture = React.useRef(null); // gesture shuru hone ke waqt ki haalat
  const pinchedThisTouch = React.useRef(false); // is touch me pinch hua? to aakhri ungli tap nahi
  const lastTap = React.useRef({ time: 0, x: 0, y: 0 });
  const tapTimer = React.useRef(0);
  const [zoomed, setZoomed] = React.useState(false);

  const paint = React.useCallback((animate) => {
    const el = layerRef.current;
    if (!el) return;
    const { s, x, y } = view.current;
    el.style.transition = animate ? 'transform 180ms ease-out' : 'none';
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
  }, []);

  /** Tasveer ko stage ke bahar mat jaane do — kinare se aage kheencho to wahin ruk jaaye. */
  const clamp = React.useCallback(() => {
    const st = stageRef.current;
    if (!st) return;
    const W = st.clientWidth;
    const H = st.clientHeight;
    const v = view.current;
    v.s = Math.min(MAX, Math.max(MIN, v.s));
    v.x = Math.min(0, Math.max(W - W * v.s, v.x));
    v.y = Math.min(0, Math.max(H - H * v.s, v.y));
  }, []);

  const reset = React.useCallback((animate) => {
    view.current = { s: 1, x: 0, y: 0 };
    paint(animate);
    setZoomed(false);
  }, [paint]);

  /** Stage ka point (px, py) jahan hai wahin rahe, aur scale `s` ho jaaye. */
  const zoomAt = React.useCallback((s, px, py, animate) => {
    const v = view.current;
    const k = s / v.s;
    v.x = px - (px - v.x) * k;
    v.y = py - (py - v.y) * k;
    v.s = s;
    clamp();
    paint(animate);
    setZoomed(v.s > 1.01);
  }, [clamp, paint]);

  // Nayi tasveer = naya shuruaat.
  React.useEffect(() => { reset(false); }, [src, reset]);
  React.useEffect(() => () => window.clearTimeout(tapTimer.current), []);

  // Wheel: native listener, kyunki React ka onWheel passive hota hai aur usme
  // preventDefault chalta nahi — tab page/parent scroll ho jaata zoom ke bajaye.
  React.useEffect(() => {
    const st = stageRef.current;
    if (!st) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = st.getBoundingClientRect();
      const next = Math.min(MAX, Math.max(MIN, view.current.s * Math.exp(-e.deltaY * 0.0015)));
      if (next <= 1.01) reset(false);
      else zoomAt(next, e.clientX - r.left, e.clientY - r.top, false);
    };
    st.addEventListener('wheel', onWheel, { passive: false });
    return () => st.removeEventListener('wheel', onWheel);
  }, [reset, zoomAt]);

  const local = (e) => {
    const r = stageRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Jitni ungliyan abhi hain, unke hisaab se naya gesture shuru karo. */
  const begin = () => {
    const list = [...pointers.current.values()];
    const v = view.current;
    if (list.length >= 2) {
      const [a, b] = list;
      pinchedThisTouch.current = true;
      gesture.current = {
        kind: 'pinch',
        d: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        s: v.s, x: v.x, y: v.y,
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
      };
    } else if (list.length === 1) {
      const p = list[0];
      gesture.current = { kind: 'pan', px: p.x, py: p.y, x: v.x, y: v.y };
    } else {
      gesture.current = null;
    }
  };

  const onPointerDown = (e) => {
    // Right/middle click na tap hai na kheenchna — pehle right-click se bhi viewer band
    // ho jaata tha (aur upar se browser ka menu khulta).
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Naya touch shuru hua = pichhle tap ka "band karo" timer ab bekaar. Ya to ye double-tap
    // ka doosra tap hai, ya koi naya gesture. Bina iske dheema double-tap (doosri ungli 280ms
    // ke paas uthi) beech me hi viewer band kar deta tha — pehle tap ka timer doosre tap ke
    // dauraan chal jaata.
    if (tapTimer.current) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = 0;
    }
    // Capture se ungli stage ke bahar jaaye tab bhi move/up yahin aate hain. Kuch haalaton
    // me (pointer pehle hi khatam) ye error phenkta hai — uske chalte gesture na toote.
    try { stageRef.current.setPointerCapture(e.pointerId); } catch { /* koi baat nahi */ }
    const p = local(e);
    pointers.current.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: e.timeStamp });
    begin();
  };

  const onPointerMove = (e) => {
    const cur = pointers.current.get(e.pointerId);
    if (!cur) return;
    const p = local(e);
    cur.x = p.x;
    cur.y = p.y;
    const G = gesture.current;
    if (!G) return;
    const v = view.current;
    if (G.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      // 1x se thoda neeche jaane do (rubber band) — chhodte hi wapas 1x par aa jaayega.
      const s = Math.min(MAX, Math.max(MIN * 0.85, (G.s * d) / G.d));
      // Shuru me ungliyon ke beech jo hissa tha, wo ab bhi ungliyon ke beech rahe.
      const cx = (G.mx - G.x) / G.s;
      const cy = (G.my - G.y) / G.s;
      v.s = s;
      v.x = mx - cx * s;
      v.y = my - cy * s;
      paint(false);
    } else if (G.kind === 'pan' && v.s > 1.01) {
      v.x = G.x + (p.x - G.px);
      v.y = G.y + (p.y - G.py);
      clamp();
      paint(false);
    }
  };

  const finish = (e, cancelled) => {
    const cur = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    const wasPinch = gesture.current?.kind === 'pinch';

    if (wasPinch) {
      if (view.current.s < 1.02) reset(true);
      else {
        clamp();
        paint(true);
        setZoomed(true);
      }
    }
    begin(); // bachi hui ungli naye sire se kheenchna shuru kare

    if (pointers.current.size > 0) return;
    const pinched = pinchedThisTouch.current;
    pinchedThisTouch.current = false;
    if (cancelled || pinched || !cur) return;

    // Tap ya double-tap?
    const moved = Math.hypot(cur.x - cur.sx, cur.y - cur.sy);
    if (moved > TAP_SLOP_PX || e.timeStamp - cur.t > TAP_MAX_MS) return;

    const L = lastTap.current;
    // Gap pehle tap ke UTHNE se doosre tap ke LAGNE tak naapo (cur.t = is tap ka pointerdown)
    // — double-tap ki aam paribhasha. Uthne-se-uthne tak naapne par doosra tap thoda der
    // dabaya to double-tap nahi ginta tha.
    if (cur.t - L.time < TAP_GAP_MS && Math.hypot(cur.x - L.x, cur.y - L.y) < 30) {
      window.clearTimeout(tapTimer.current);
      lastTap.current = { time: 0, x: 0, y: 0 };
      if (view.current.s > 1.01) reset(true);
      else zoomAt(DOUBLE_TAP_SCALE, cur.x, cur.y, true);
      return;
    }
    lastTap.current = { time: e.timeStamp, x: cur.x, y: cur.y };
    if (onTap && view.current.s <= 1.01) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = window.setTimeout(() => {
        tapTimer.current = 0;
        // Beech me koi zoom ho gaya ho to band mat karo.
        if (view.current.s <= 1.01) onTap();
      }, TAP_GAP_MS);
    }
  };

  return (
    <div
      ref={stageRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      className={cn(
        'relative h-full w-full touch-none select-none overflow-hidden',
        zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
        className,
      )}
    >
      <div
        ref={layerRef}
        className="absolute inset-0 origin-top-left will-change-transform"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={cn('pointer-events-none h-full w-full object-contain', imgClassName)}
        />
      </div>
    </div>
  );
}
