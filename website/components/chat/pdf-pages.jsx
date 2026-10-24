'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * PDF ko app ke ANDAR dikhana — pdf.js se, page-by-page canvas par.
 *
 * Kyun ye sab, seedha <iframe src=pdf> kyun nahi: Android Chrome PDF ko page ke andar
 * render karta hi nahi — download kar deta hai. Owner ka kehna saaf tha ki file app me hi
 * khule, download tab tak nahi jab tak khud na chahein. Isliye Mozilla ka pdf.js (Firefox
 * isi se PDF dikhata hai). Ye sirf tab load hota hai jab koi PDF khole — chat ke bundle
 * me nahi baitha.
 *
 * Yaadasht (phone par sabse zaroori):
 *   • Har page ki jagah pehle sirf ek khaali dabba (sahi anupaat ka) — scroll ki lambai
 *     sahi rehti hai, par canvas nahi banta.
 *   • Canvas tabhi banta hai jab page screen ke paas aaye (IntersectionObserver), aur
 *     door jaate hi chhod diya jaata hai. 100-page PDF par bhi 3-5 canvas se zyada nahi.
 *   • Band karte hi loading task destroy — worker ka kaam beech me hi ruk jaata hai.
 *
 * ZOOM (`zoom` prop, 24 Oct 2026): phone par page ka do-ungli zoom band hai (dekho
 * app/layout.jsx). Us din tak log PDF ka chhota text BROWSER zoom se padhte the — 390px
 * iPhone par A4 ka 10pt text lagbhag 6px ka dikhta hai. Isliye viewer ke header me
 * +/- buttons hain aur yahan:
 *   • document DOBARA load nahi hota — sirf pages naye scale par dobara bante hain;
 *   • CSS se bada nahi kiya jaata, canvas sach me us scale par banta hai — warna text
 *     dhundhla ho jaata (pehle browser zoom me yahi hota tha);
 *   • canvas ka area 16M pixel se upar nahi jaata — iOS usse bade canvas ko chupchaap
 *     KHAALI dikhata hai;
 *   • zoom >1 par dabba screen se chauda ho jaata hai aur bahar wala `.overflow-auto`
 *     dono taraf scroll karta hai.
 *
 * Assets (`/pdf.worker.min.mjs`, `/pdfjs/...`) public/ se — scripts/copy-pdfjs-assets.js.
 * wasm ke bina JPEG2000/JBIG2 wali scanned PDF khaali dikhti; cmaps/fonts ke bina
 * kuch PDF ka text gayab. Trailing slash zaroori hai (pdf.js khud maangta hai).
 */
const ASSETS = {
  workerSrc: '/pdf.worker.min.mjs',
  wasmUrl: '/pdfjs/wasm/',
  cMapUrl: '/pdfjs/cmaps/',
  standardFontDataUrl: '/pdfjs/standard_fonts/',
};

/** iOS Safari ka canvas area ka dhakkan (4096×4096). Usse bada canvas khaali dikhta hai. */
const MAX_CANVAS_PIXELS = 16_000_000;

export function PdfPages({ url, zoom = 1, onError }) {
  const hostRef = React.useRef(null);
  const wrapRef = React.useRef(null);
  const [status, setStatus] = React.useState({ loading: true, pages: 0, error: '' });

  // Document aur uske dabbe ek baar bante hain; zoom badalne par sirf ye dobara chalte hain.
  const live = React.useRef(null); // { slots, io, release, observeAll, fit }
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;

  React.useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    let task = null;
    let io = null;
    const host = hostRef.current;
    if (host) {
      host.replaceChildren();
      host.style.width = '';
    }
    if (wrapRef.current) {
      wrapRef.current.style.maxWidth = '';
      wrapRef.current.style.width = '';
    }
    live.current = null;
    setStatus({ loading: true, pages: 0, error: '' });

    (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = ASSETS.workerSrc;
      task = pdfjs.getDocument({
        url,
        wasmUrl: ASSETS.wasmUrl,
        cMapUrl: ASSETS.cMapUrl,
        cMapPacked: true,
        standardFontDataUrl: ASSETS.standardFontDataUrl,
      });
      const doc = await task.promise;
      if (cancelled || !host) return;

      // "Fit" = 1x par jo chaudai hoti, ZOOM KI HAALAT SE ALAG. Wrapper zoom >1 par `w-max`
      // ho jaata hai, aur agar "Opening PDF…" ke dauraan hi koi + daba de to khaali host
      // 0px ka hota — `host.clientWidth` se naapne par fit galat (320) aata aur har zoom
      // ka scale bigad jaata. Isliye wrapper ke parent ki content-chaudai, max-w-3xl
      // (768px) par dhakkan — theek wahi jo 1x par wrapper ki hoti hai.
      const box = host.parentElement?.parentElement;
      let avail = 320;
      if (box) {
        const cs = getComputedStyle(box);
        avail = box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      }
      const fit = Math.max(240, Math.min(768, avail || 320));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const first = await doc.getPage(1);
      const base1 = first.getViewport({ scale: 1 });
      first.cleanup();

      // Har page ke liye ek dabba — anupaat page 1 jaisa maan lete hain; asli page
      // aane par dabba apne aap sahi ho jaata hai.
      const slots = [];
      for (let i = 1; i <= doc.numPages; i += 1) {
        const slot = document.createElement('div');
        slot.dataset.page = String(i);
        slot.dataset.state = 'empty';
        slot.className = 'w-full overflow-hidden rounded-md bg-white shadow';
        slot.style.aspectRatio = `${base1.width} / ${base1.height}`;
        host.appendChild(slot);
        slots.push(slot);
      }
      setStatus({ loading: false, pages: doc.numPages, error: '' });

      const render = async (slot) => {
        if (slot.dataset.state !== 'empty') return;
        slot.dataset.state = 'rendering';
        // Har render ka apna token. Zoom badalne ya dabba screen se hatne par token badal
        // jaata hai — tab ye render poora hokar bhi apna canvas nahi lagata, warna ek
        // purana render baad me pahunch kar naye wale ko dhak sakta tha.
        const token = String((Number(slot.dataset.token) || 0) + 1);
        slot.dataset.token = token;
        const zoomAtStart = zoomRef.current;
        try {
          const page = await doc.getPage(Number(slot.dataset.page));
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          slot.style.aspectRatio = `${base.width} / ${base.height}`;
          let renderScale = ((fit * zoomAtStart) / base.width) * dpr;
          const probe = page.getViewport({ scale: renderScale });
          const area = probe.width * probe.height;
          if (area > MAX_CANVAS_PIXELS) renderScale *= Math.sqrt(MAX_CANVAS_PIXELS / area);
          const vp = page.getViewport({ scale: renderScale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.className = 'block';
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
          page.cleanup();
          if (cancelled) return;
          if (slot.dataset.token !== token || zoomRef.current !== zoomAtStart) {
            canvas.width = 0;
            canvas.height = 0;
            return;
          }
          slot.replaceChildren(canvas);
          slot.dataset.state = 'ready';
        } catch {
          if (!cancelled) slot.dataset.state = 'empty';
        }
      };
      const release = (slot) => {
        // Beech me chal raha render bhi ab bekaar hai — token badlo taaki wo na lage.
        slot.dataset.token = String((Number(slot.dataset.token) || 0) + 1);
        if (slot.dataset.state === 'empty') return;
        const c = slot.firstChild;
        if (c) { c.width = 0; c.height = 0; } // GPU memory turant chhoote
        slot.replaceChildren();
        slot.dataset.state = 'empty';
      };

      // Screen ke aas-paas do screen tak render rakho, usse door chhod do.
      const scrollRoot = host.closest('.overflow-auto') || null;
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) (e.isIntersecting ? render : release)(e.target);
        },
        { root: scrollRoot, rootMargin: '200% 0px' },
      );
      // Dobara observe karne par IO har dabbe ke liye ABHI ki haalat batata hai — yahi
      // zoom ke baad dikhne wale pages ko dobara banwata hai.
      const observeAll = () => {
        io.disconnect();
        slots.forEach((s) => io.observe(s));
      };
      observeAll();
      live.current = { slots, release, observeAll, fit, scrollRoot };
      // Load ke beech zoom badla ho to use abhi laagu karo.
      if (zoomRef.current !== 1) applyZoom(zoomRef.current);
    })().catch((e) => {
      if (cancelled) return;
      const msg = e?.message || 'Could not open this PDF';
      setStatus({ loading: false, pages: 0, error: msg });
      onError?.(e);
    });

    return () => {
      cancelled = true;
      io?.disconnect();
      live.current = null;
      // task.destroy() doc ko bhi destroy karta hai — aur agar load beech me hi tha to
      // worker ka kaam wahin rok deta hai (warna wo peeche chalta rehta).
      task?.destroy().catch(() => {});
    };
    // applyZoom stable hai (useCallback, koi dep nahi)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, onError]);

  /**
   * Naya zoom: dabbe chaude karo, purane canvas chhodo, dikhne wale dobara banwao.
   *
   * Wrapper ki chaudai bhi YAHIN badalti hai, JSX ki class se nahi — jaan-boojhkar. Pehle
   * class `zoom > 1 ? 'w-max' : 'max-w-3xl'` thi: React us class ko is function se PEHLE
   * laga deta tha, aur us beech ka layout canvas ki asli PIXEL chaudai par phail jaata tha
   * (jo screen density ≥1.5 par kaafi zyada hoti hai). Padhne ki jagah (`ratio`) usi
   * bigde layout par naapi jaati thi — page 6 se 1.5x karo to page 3 par pahunchte the.
   * Ab pehle naapo, phir ek saath badlo.
   */
  const applyZoom = React.useCallback((z) => {
    const L = live.current;
    const host = hostRef.current;
    const wrap = wrapRef.current;
    if (!L || !host || !wrap) return;
    const sc = L.scrollRoot;
    // Jo page padh rahe the wahi samne rahe — scroll ko naye lambai ke anupaat me le jao.
    const ratio = sc && sc.scrollHeight > sc.clientHeight ? sc.scrollTop / sc.scrollHeight : 0;
    wrap.style.maxWidth = z > 1 ? 'none' : '';
    wrap.style.width = z > 1 ? 'max-content' : '';
    host.style.width = z > 1 ? `${Math.round(L.fit * z)}px` : '';
    L.slots.forEach(L.release);
    requestAnimationFrame(() => {
      if (sc) {
        sc.scrollTop = ratio * sc.scrollHeight;
        sc.scrollLeft = Math.max(0, (sc.scrollWidth - sc.clientWidth) / 2);
      }
      L.observeAll();
    });
  }, []);

  const firstZoom = React.useRef(true);
  React.useEffect(() => {
    // Pehli baar (load ke saath) zoom 1 hai — kuch karna nahi; load wala raasta sambhalta hai.
    if (firstZoom.current) { firstZoom.current = false; return; }
    applyZoom(zoom);
  }, [zoom, applyZoom]);

  return (
    // Class kabhi nahi badalti — zoom par chaudai applyZoom likhta hai (wajah upar).
    <div ref={wrapRef} className="mx-auto w-full max-w-3xl">
      {status.error ? (
        <p className="py-10 text-center text-sm text-white/80">{status.error}</p>
      ) : null}
      {status.loading && !status.error ? (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-white/80">
          <Loader2 className="size-4 animate-spin" /> Opening PDF…
        </p>
      ) : null}
      <div ref={hostRef} className="flex flex-col gap-3" />
    </div>
  );
}
