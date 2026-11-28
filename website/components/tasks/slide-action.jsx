'use client';

import * as React from 'react';
import { Check, ChevronsRight, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * SLIDE-TO-DO — phone par call uthane jaisa (owner ka faisla, 19 Nov 2026, idea I205).
 *
 * Kyun gole ki jagah ye: task band karne ke liye row ke kone me ek 20px ka gola dabana
 * padta tha. Ungli se aas-paas ka galat task dab jaana aasan tha, aur galat tap par
 * delegated task par dene wale ko push chali jaati hai (jo wapas nahi aa sakti). Slide
 * galti se nahi hoti — ungli ko poora raasta paar karna padta hai.
 *
 * NIYAM JO YAHAN TAY HUE:
 *  • Thodi door kheench kar chhod dene par kuch NAHI hota — knob wapas chala jaata hai.
 *    Kaam tabhi hota hai jab ungli {THRESHOLD*100}% raasta paar kar jaye. Owner ne yahi
 *    chuna ("swipe lamba karna padega") taaki delegated task par galti se na ho jaye.
 *  • `touch-action: pan-y` — upar-neeche scroll browser ka, daayein-baayein hamara. Bina
 *    iske list scroll karte waqt slider pakad leta, ya slide karte waqt page khisak jaata.
 *  • Pointer events (touch/mouse/pen ek saath) + setPointerCapture: ungli track se bahar
 *    chali jaye tab bhi drag chalta rehta hai, warna beech raaste me chhoot jaata.
 *  • Row ka apna onClick task ka dialog kholta hai — isliye yahan har pointer/click event
 *    roka jaata hai, warna har slide ke baad dialog khul jaata.
 *
 * LITE MODE: wahan sirf transition-duration ghatta hai (globals.css), transform nahi.
 * Drag ke dauraan hum transform SEEDHA set karte hain — koi transition nahi — isliye
 * ungli ke saath knob wahan bhi utna hi chikna chalta hai. Sirf chhodne par wapas jaana
 * turant hoga. Kaam kahin bhi animation par tika nahi hai (dekho lite-mode-animations).
 */

const THRESHOLD = 0.82; // itna raasta paar = ho gaya

export function SlideAction({
  label,
  completingLabel,
  Icon = Check,
  onComplete,
  disabled = false,
  // Server ka jawab abhi aaya nahi — knob aakhir par roke rakho (upar wala effect dekho).
  busy = false,
  tone = 'success',
  className,
}) {
  const trackRef = React.useRef(null);
  const startX = React.useRef(0);
  const maxX = React.useRef(0);
  const [x, setX] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const [fired, setFired] = React.useState(false);
  // Faisle REF se hote hain, state se nahi — state agle render par milti hai.
  // Tez flick me pointerdown → pointermove → pointerup ek hi tick me aa jaate hain; tab
  // `dragging` abhi `false` hi hota hai aur poora slide chup-chaap gir jaata hai. Browser
  // me chala kar yahi pakda: slide kuch nahi karta tha, aur peechhe row ka click chalkar
  // task ka dialog khol deta tha. State sirf dikhane ke liye bachi hai.
  const dragRef = React.useRef(false);
  const firedRef = React.useRef(false);
  const xRef = React.useRef(0);
  const setPos = (v) => { xRef.current = v; setX(v); };

  // Knob 32px + dono taraf 2px ka gap. Track ki chaudai har row me alag ho sakti hai
  // (folder ke andar thodi kam), isliye har drag ke SHURU me naapi jaati hai — ek baar
  // naap kar rakh lete to phone ghumane par aadha raasta hi bachta.
  const measure = () => {
    const el = trackRef.current;
    maxX.current = el ? Math.max(0, el.clientWidth - 36) : 0;
  };

  // Chal jaane ke baad knob thodi der aakhir par rukta hai (taaki dikhe ki ho gaya), phir
  // apni jagah laut aata hai.
  //
  // KYUN LAUTNA ZAROORI HAI: zyadatar baar ye row hi badal jaati hai (slider ki jagah
  // ginti aa jaati hai) ya list se nikal jaati hai, to kisi ko farak nahi padta. Par do
  // soorat me row wahin rehti hai — History me "Slide to undo" karke confirm par Cancel
  // dabana, aur server ka jawab fail aana. Wahan knob daayein hi ATAK jaata tha aur
  // slider dobara kaam hi nahi karta (browser me yahi pakda).
  //
  // ...PAR JAB TAK SERVER KA JAWAB NA AA JAYE, TAB TAK NAHI. `busy` wahi batata hai.
  // Lambda thanda ho to jawab aaram se 2-3 second le leta hai; bina is shart ke slider
  // 0.7 second me khul jaata aur banda dobara slide kar deta — ek hi kaam ke do request.
  // Server dobara kuch nahi karta (wo DONE ko dobara DONE nahi likhta), par screen par
  // ginti do baar shuru hoti aur jhilmil dikhta.
  React.useEffect(() => {
    if (!fired || busy) return undefined;
    const h = setTimeout(() => {
      firedRef.current = false;
      setFired(false);
      setPos(0);
    }, 700);
    return () => clearTimeout(h);
  }, [fired, busy]);

  const end = React.useCallback((commit) => {
    dragRef.current = false;
    setDragging(false);
    if (commit) {
      firedRef.current = true;
      setFired(true);
      setPos(maxX.current);
      onComplete?.();
    } else {
      setPos(0);
    }
  }, [onComplete]);

  const onPointerDown = (e) => {
    if (disabled || firedRef.current) return;
    e.stopPropagation();
    measure();
    startX.current = e.clientX - xRef.current;
    dragRef.current = true;
    setDragging(true);
    // Capture se ungli track se bahar nikal jaane par bhi drag chalta rehta hai. Kabhi-
    // kabhi browser ise mana kar deta hai (pointer tab tak khatam ho chuka ho) aur ye
    // phenk deta hai — us soorat me drag capture ke bina bhi theek chalta hai, isliye
    // galti nigal lete hain. Bina iske poora handler wahin ruk jaata.
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* capture optional */ }
  };

  const onPointerMove = (e) => {
    if (!dragRef.current || firedRef.current) return;
    e.stopPropagation();
    setPos(Math.min(maxX.current, Math.max(0, e.clientX - startX.current)));
  };

  const onPointerUp = (e) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    end(maxX.current > 0 && xRef.current >= maxX.current * THRESHOLD);
  };

  // Keyboard ka raasta: knob ek asli button hai, to Enter/Space se bhi ho jaata hai.
  // (Row ka purana gol button bhi apni jagah hai, isliye bina ungli wale raaste band
  // nahi hue.)
  const onKeyDown = (e) => {
    if (disabled || firedRef.current) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      measure();
      end(true);
    }
  };

  const pct = maxX.current > 0 ? Math.min(1, x / maxX.current) : 0;
  const tones = {
    success: 'bg-success text-white',
    warning: 'bg-warning text-amber-950',
    muted: 'bg-foreground/70 text-background',
  };

  return (
    <div
      ref={trackRef}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'relative mt-2 h-9 w-full select-none overflow-hidden rounded-full bg-foreground/[0.06] ring-1 ring-border/60',
        disabled && 'opacity-50',
        className,
      )}
    >
      {/* Peechhe bharta hua rang — ungli ke saath. Sirf dikhawa hai; kaam iska nahi. */}
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0 rounded-full', tones[tone] || tones.success, !dragging && 'transition-[width] duration-200')}
        style={{ width: `${x + 36}px`, opacity: 0.18 }}
      />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground',
          !dragging && 'transition-opacity duration-200',
        )}
        style={{ opacity: 1 - pct * 1.4 }}
      >
        <ChevronsRight className="size-3.5 opacity-60" />
        {fired ? completingLabel || label : label}
      </span>
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        // Drag ke baad browser ek `click` bhi banata hai. Row ka apna onClick task ka
        // dialog kholta hai, to use yahin rokna padta hai — warna har slide ke baad
        // dialog khul jaata (browser me yahi hua).
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'absolute left-0.5 top-0.5 flex size-8 touch-pan-y items-center justify-center rounded-full shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary',
          tones[tone] || tones.success,
          dragging ? 'cursor-grabbing' : 'cursor-grab transition-transform duration-200',
        )}
        style={{ transform: `translateX(${x}px)` }}
      >
        <Icon className="size-4" />
      </button>
    </div>
  );
}

/**
 * Slide ho jaane ke baad ka 5 second — "ho gaya, abhi History me jaa raha hai".
 *
 * Owner ne yahi maanga: kaam turant ho, par row turant gayab na ho; slider ki jagah ek
 * ghadi chale jo batati rahe ki ab History me jaane me kitna baaki hai, aur usi dauraan
 * wapas lene ka mauka ho.
 *
 * Ginti SHABDON me hai, sirf patti ke bharne par nahi — Lite mode me patti ek jhatke me
 * bhar jaati hai, aur tab bhi "3s" padha jaa sakta hai. Jo baat batani hai wo kabhi
 * animation ke bharose nahi chhodni ([[lite-mode-animations]]).
 */
export function SlideDonePending({ secondsLeft, totalSeconds, onUndo, undoLabel = 'Undo' }) {
  const pct = totalSeconds > 0 ? Math.max(0, Math.min(1, secondsLeft / totalSeconds)) : 0;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="relative mt-2 flex h-9 w-full select-none items-center gap-2 overflow-hidden rounded-full bg-success/10 px-3 ring-1 ring-success/30"
    >
      {/* `width` nahi, `scaleX` — poora kyun, globals.css ke ".tick-bar" wale hisse me
          likha hai. Chhota saar: Lite mode transition maar deta tha aur patti har 500ms
          par ek jhatke se kood-ti thi; ab transition wapas hai aur transform hone ki wajah
          se pehle se sasti bhi. `--tick-ms` neeche ke timer (task-board.jsx ka 500ms wala
          setInterval) ke barabar rehna chahiye. */}
      <span
        aria-hidden
        className="tick-bar absolute inset-y-0 left-0 w-full bg-success/15"
        style={{ '--tick-ms': '500ms', transform: `scaleX(${pct})` }}
      />
      <Check className="relative size-3.5 shrink-0 text-success" />
      <span className="relative min-w-0 flex-1 truncate text-xs font-medium text-success">
        {/* Ginti kabhi poore waqt se zyada na dikhe aur 0 par na pahunche — `min` upar ki
            hadd hai, `max` neeche ki. */}
        Done · moving to History in {Math.min(totalSeconds, Math.max(1, Math.ceil(secondsLeft)))}s
      </span>
      {onUndo ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onUndo(); }}
          className="relative inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-foreground underline-offset-2 hover:underline"
        >
          <Undo2 className="size-3.5" /> {undoLabel}
        </button>
      ) : null}
    </div>
  );
}
