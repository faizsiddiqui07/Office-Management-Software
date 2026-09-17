'use client';

import * as React from 'react';

/**
 * WhatsApp jaisa "der tak dabao" — phone par message ke options isi se khulte hain.
 *
 * Kyun chahiye: bubble ke hover-wale buttons phone par dikhte hi nahi (hover hota hi
 * nahi). Isliye ungli 450ms tikaye rakho → menu. Beech me ungli 10px se zyada sarki (scroll
 * kar raha tha) to kuch nahi hota — warna har scroll par menu khul jaata.
 *
 * Desktop par right-click bhi yahi menu kholta hai (contextmenu). Android me long-press
 * par bhi contextmenu event aata hai — use rokna zaroori hai, warna browser ka apna
 * "copy / select" wala menu upar aa jaata.
 *
 * Long-press ke baad jo click aata hai (ungli uthate hi) use nigal lete hain — warna
 * photo wale bubble par menu ke saath-saath photo bhi khul jaati.
 */
export function useLongPress(onLongPress, { ms = 450, moveTolerance = 10 } = {}) {
  const timer = React.useRef(null);
  const start = React.useRef(null);
  const fired = React.useRef(false);
  const cb = React.useRef(onLongPress);
  cb.current = onLongPress;

  const clear = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  React.useEffect(() => clear, [clear]);

  return React.useMemo(
    () => ({
      onPointerDown: (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return; // right-click contextmenu se aayega
        fired.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          fired.current = true;
          cb.current(e);
        }, ms);
      },
      onPointerMove: (e) => {
        if (!start.current) return;
        if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > moveTolerance) clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onContextMenu: (e) => {
        e.preventDefault();
        clear();
        fired.current = true;
        cb.current(e);
      },
      onClickCapture: (e) => {
        if (!fired.current) return;
        fired.current = false;
        e.stopPropagation();
        e.preventDefault();
      },
    }),
    [ms, moveTolerance, clear],
  );
}
