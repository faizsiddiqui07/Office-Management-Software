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

export function PdfPages({ url, onError }) {
  const hostRef = React.useRef(null);
  const [status, setStatus] = React.useState({ loading: true, pages: 0, error: '' });

  React.useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    let task = null;
    let io = null;
    const host = hostRef.current;
    if (host) host.replaceChildren();
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

      const width = Math.max(240, host.clientWidth || 320);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const first = await doc.getPage(1);
      const base1 = first.getViewport({ scale: 1 });
      const scale = width / base1.width;
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
        try {
          const page = await doc.getPage(Number(slot.dataset.page));
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          slot.style.aspectRatio = `${base.width} / ${base.height}`;
          const vp = page.getViewport({ scale: scale * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.className = 'block';
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
          page.cleanup();
          if (cancelled) return;
          slot.replaceChildren(canvas);
          slot.dataset.state = 'ready';
        } catch {
          if (!cancelled) slot.dataset.state = 'empty';
        }
      };
      const release = (slot) => {
        if (slot.dataset.state !== 'ready') return;
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
      slots.forEach((s) => io.observe(s));
    })().catch((e) => {
      if (cancelled) return;
      const msg = e?.message || 'Could not open this PDF';
      setStatus({ loading: false, pages: 0, error: msg });
      onError?.(e);
    });

    return () => {
      cancelled = true;
      io?.disconnect();
      // task.destroy() doc ko bhi destroy karta hai — aur agar load beech me hi tha to
      // worker ka kaam wahin rok deta hai (warna wo peeche chalta rehta).
      task?.destroy().catch(() => {});
    };
  }, [url, onError]);

  return (
    <div className="mx-auto w-full max-w-3xl">
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
