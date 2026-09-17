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
 * Har page container ki chaudai me fit hota hai; devicePixelRatio tak (max 2x) sharp
 * render, taaki phone par text dhundhla na lage.
 */
export function PdfPages({ url, onError }) {
  const hostRef = React.useRef(null);
  const [status, setStatus] = React.useState({ loading: true, pages: 0, done: 0, error: '' });

  React.useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    let doc = null;
    const host = hostRef.current;
    if (host) host.innerHTML = '';
    setStatus({ loading: true, pages: 0, done: 0, error: '' });

    (async () => {
      const pdfjs = await import('pdfjs-dist');
      // Worker `public/` se: webpack ke `new URL(..., import.meta.url)` wale raaste par
      // Terser worker ko minify karne ki koshish me toot jaata hai. `public/pdf.worker.min.mjs`
      // package.json ke postinstall se installed version ke saath sync rehta hai.
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      doc = await pdfjs.getDocument({ url }).promise;
      if (cancelled) return;
      setStatus((s) => ({ ...s, pages: doc.numPages }));

      const width = Math.max(240, host?.clientWidth || 320);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let i = 1; i <= doc.numPages; i += 1) {
        const page = await doc.getPage(i);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const vp = page.getViewport({ scale: scale * dpr });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        canvas.className = 'block rounded-md bg-white shadow';
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        if (cancelled) return;
        host?.appendChild(canvas);
        setStatus((s) => ({ ...s, loading: false, done: i }));
      }
    })().catch((e) => {
      if (cancelled) return;
      const msg = e?.message || 'Could not open this PDF';
      setStatus({ loading: false, pages: 0, done: 0, error: msg });
      onError?.(e);
    });

    return () => {
      cancelled = true;
      try { doc?.destroy(); } catch { /* */ }
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
      {!status.loading && status.pages > status.done ? (
        <p className="py-3 text-center text-xs text-white/60">
          Page {status.done} of {status.pages}…
        </p>
      ) : null}
    </div>
  );
}
