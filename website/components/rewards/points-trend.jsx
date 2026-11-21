'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { monthLabel } from '@/lib/reward-periods';

/**
 * MAHINE-DAR-MAHINE POINTS — zero ki lakeer se upar kamaye, neeche kate.
 *
 * KYA DIKKAT THI: Rewards page ka "Yearly (FY)" mode poore saal ka EK jod deta hai aur
 * neeche saikdon rows ki ek chapti list. "Kaun sa mahina kharab gaya" ka jawab kahin
 * nahi. Prod ka ek asli udaharan (Priyanshi Patel, Jul–Nov 2026) — page sirf "+231"
 * dikhata hai, jabki andar ye chhupa hai:
 *
 *     Jul  90 kamaye, 90 kate  → net   0
 *     Aug  89 kamaye, 51 kate  → net +38
 *     Sep  76 kamaye, 38 kate  → net +38
 *     Oct 118 kamaye, 22 kate  → net +96
 *     Nov  69 kamaye, 10 kate  → net +59
 *
 * Isme ek poori kahani hai — katauti har mahine gir rahi hai (90 → 51 → 38 → 22 → 10).
 * "+231" me wo bilkul gayab hai.
 *
 * DO BAR KYUN, EK NET KA BAR KYUN NAHI: July ise khud saabit kar deta hai. Sirf net ka
 * bar banate to July ZERO par hota — yaani khaali, jaise us mahine kuch hua hi na ho.
 * Jabki us mahine poore 90 kamaye AUR poore 90 kate. Aur Aug/Sep dono ka net +38 hai,
 * par ek 89−51 hai aur doosra 76−38 — net dono ko ek jaisa dikha deta.
 *
 * EK HI PAIMANA DONO TARAF: upar aur neeche ka px-per-point ek hi hai, isliye 90 ka
 * katauti-bar 90 ke kamai-bar jitna hi lamba hota hai. Alag paimane par chhoti katauti
 * badi dikhti aur chart jhooth bolta. Zero ki lakeer isi wajah se beech me nahi, data ke
 * hisaab se baithti hai.
 *
 * DATA KAHAN SE: `/bonus/me` (ya `/bonus/user/:id`) pehle se poore range ki entries deta
 * hai aur har entry par uska `month` likha hota hai — mahine ke jod yahin client par
 * bante hain. KOI BACKEND BADLAAV NAHI. Server ek range me 1200 entries tak bhejta hai;
 * prod me sabse bhaari banda 5 mahine me 179 par hai, yaani saal ka ~430 — teen guna
 * jagah bachi hui hai.
 *
 * LITE MODE: koi animation nahi — bar seedha apni oonchai par rendar hote hain.
 */

// Bar wale hisse ki kul oonchai. Isi me zero ki lakeer ke dono taraf ka hissa bantta hai.
const CHART_PX = 140;
// Jo mahina zero nahi hai par bahut chhota hai, uska bar bhi dikhna chahiye — warna
// "2 points kate" aur "kuch nahi kata" ek jaise lagte hain.
const MIN_BAR_PX = 3;
// Bar itne se zyada chauda nahi hoga. Kam mahine hon to khambe chaude ho jaate hain, aur
// bina iske bar 160px ka blok ban jaata hai — chart dekhne me bar-chart lagna chahiye.
const BAR_MAX_W = 'max-w-11'; // 2.75rem

/** entries → har mahine ka { earned, lost, net, count }. */
function foldByMonth(entries, months) {
  const base = new Map(months.map((m) => [m, { month: m, earned: 0, lost: 0, net: 0, count: 0 }]));
  for (const e of entries ?? []) {
    const row = base.get(e?.month);
    if (!row) continue; // window ke bahar ka mahina
    const p = Number(e.points) || 0;
    if (p >= 0) row.earned += p;
    else row.lost += -p; // `lost` hamesha DHANATMAK rakha jaata hai — oonchai isi se banti hai
    row.net += p;
    row.count += 1;
  }
  return months.map((m) => base.get(m));
}

/**
 * Bar ke apne points — hare bar me kitne mile, laal me kitne gaye.
 *
 * Owner ka faisla (21 Nov 2026): upar ka net jaisa tha waisa rahe, aur dono bar apne
 * number khud bhi batayein. Pehle ye sirf hover ke tooltip me the, yaani phone par kahin
 * nahi — aur "+47" dekh kar ye pata nahi chalta tha ki 53 mile the aur 6 gaye.
 *
 * CHHOTA BAR, BAHAR KA NUMBER: bar ki oonchai points se banti hai, to 1 point ka bar 3px
 * ka hota hai — uske andar koi lafz nahi samaa sakta. Isliye bar itna lamba ho ki number
 * baith jaaye (TALL_PX) tabhi number ANDAR jaata hai, warna bar ke bahar uske sire par,
 * apne rang me. Dono soorat me number dikhta hai, bas jagah badal jaati hai.
 *
 * Andar ka lafz SAFED hai — bar ka bharaav /80 par kaafi gehra hai (light aur dark dono
 * me naapa gaya). Bahar ka lafz token ke rang me, kyunki wahan peechhe card hai.
 */
const TALL_PX = 18;

function BarValue({ value, px, side, negative }) {
  if (!value) return null; // zero par kuch nahi — khaali bar khud bata deta hai
  const text = negative ? `−${value}` : String(value);
  const inside = px >= TALL_PX;
  return (
    <span
      className={cn(
        'pointer-events-none w-full truncate px-0.5 text-center text-[9px] font-semibold tabular-nums',
        inside
          ? cn('text-white', side === 'top' ? 'pt-0.5' : 'pb-0.5')
          : cn('absolute', side === 'top' ? 'bottom-full mb-0.5 text-success' : 'top-full mt-0.5 text-destructive'),
      )}
    >
      {text}
    </span>
  );
}

/**
 * @param {object[]} entries      PointEntry rows (month + points chahiye)
 * @param {string[]} months       kaun se mahine dikhane hain, purane se naye (YYYY-MM)
 * @param {string}   activeMonth  abhi page par khula mahina — uska bar ujagar hota hai
 * @param {Function} onPickMonth  bar par tap — page ko us mahine par le jaata hai
 */
export function PointsTrend({ entries, months, activeMonth, onPickMonth, className }) {
  const rows = React.useMemo(() => foldByMonth(entries, months), [entries, months]);

  const maxEarned = Math.max(0, ...rows.map((r) => r.earned));
  const maxLost = Math.max(0, ...rows.map((r) => r.lost));
  const span = maxEarned + maxLost;

  // Kuch hua hi nahi is poore window me — chart dikhane ka koi matlab nahi.
  if (!rows.length || span === 0) return null;

  const pxPerPoint = CHART_PX / span;
  const upperPx = Math.round(maxEarned * pxPerPoint);
  const lowerPx = CHART_PX - upperPx;
  const barPx = (v) => (v > 0 ? Math.max(MIN_BAR_PX, Math.round(v * pxPerPoint)) : 0);

  return (
    <div className={cn('rounded-2xl border border-border/50 bg-card/50 p-3 sm:p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm font-semibold">Month by month</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] bg-success/70" /> Earned
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] bg-destructive/70" /> Lost
          </span>
        </div>
      </div>

      {/* Khambe barabar chaudai ke — `minmax(0,1fr)` taaki koi bada number khamba chauda
          na kar de. 12 mahine 375px par bhi beth jaate hain (naapa gaya). */}
      <div
        className="mt-3 grid items-end gap-1 sm:gap-1.5"
        style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}
      >
        {rows.map((r) => {
          const on = r.month === activeMonth;
          const title = `${monthLabel(r.month)} — earned ${r.earned}, lost ${r.lost}, net ${r.net > 0 ? '+' : ''}${r.net}`;
          return (
            <button
              key={r.month}
              type="button"
              onClick={() => onPickMonth?.(r.month)}
              title={title}
              aria-label={title}
              aria-pressed={on}
              className={cn(
                'group flex min-w-0 flex-col items-center rounded-md px-0.5 pb-1 pt-0.5 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                on ? 'bg-primary/10 ring-1 ring-inset ring-primary/40' : 'hover:bg-foreground/5',
              )}
            >
              {/* Net — mahine ka nateeja, bar ke upar. 9px par "+118" bhi 375px wale
                  phone me 12 khambon ke saath samaa jaata hai (naapa gaya). */}
              <span
                className={cn(
                  'mb-1 w-full truncate text-center text-[9px] font-semibold tabular-nums sm:text-[10px]',
                  r.net > 0 ? 'text-success' : r.net < 0 ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {r.net > 0 ? `+${r.net}` : r.net}
              </span>

              {/* Kamai ka hissa — bar NEECHE se badhta hai, isliye `justify-end`. */}
              <span className="flex w-full items-end justify-center" style={{ height: `${upperPx}px` }}>
                <span
                  className={cn('relative flex w-full items-start justify-center rounded-t-[3px] bg-success/80', BAR_MAX_W, on && 'bg-success')}
                  style={{ height: `${barPx(r.earned)}px` }}
                >
                  <BarValue value={r.earned} px={barPx(r.earned)} side="top" />
                </span>
              </span>

              {/* Zero ki lakeer — dono bar isi se nikalte hain. */}
              <span className="h-px w-full bg-border" />

              {/* Katauti ka hissa — bar UPAR se latakta hai. */}
              <span className="flex w-full items-start justify-center" style={{ height: `${lowerPx}px` }}>
                <span
                  className={cn('relative flex w-full items-end justify-center rounded-b-[3px] bg-destructive/80', BAR_MAX_W, on && 'bg-destructive')}
                  style={{ height: `${barPx(r.lost)}px` }}
                >
                  <BarValue value={r.lost} px={barPx(r.lost)} side="bottom" negative />
                </span>
              </span>

              <span className={cn('mt-1 w-full truncate text-center text-[10px]', on ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                {monthLabel(r.month).slice(0, 3)}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">Tap a month to open it below.</p>
    </div>
  );
}
