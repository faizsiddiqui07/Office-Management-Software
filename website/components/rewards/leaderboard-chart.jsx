'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * LEADERBOARD KA BAR CHART — poori team, zero ki lakeer ke dono taraf.
 *
 * Naap aur shakal usi dhanche se li gayi hai jo ISI PAGE par PointsTrend me pehle se hai
 * (points-trend.jsx): zero ki lakeer ke upar hara, neeche laal, aur DONO TARAF EK HI
 * PAIMANA. Alag paimane par chhota ghaata bada dikhta aur chart jhooth bolta.
 *
 * SAB DIKHTE HAIN — jod wale bhi, ghaate wale bhi (owner, 26 Nov 2026). Pehla roop sirf
 * positive dikhata tha; owner ne kaha ghaate wale bhi chahiye. Ghaata chhupane se
 * leaderboard aadha sach ban jaata tha.
 *
 * KOI "TOP 5" NAHI, BALKI SARAKNE DIYA GAYA — aur ye seedha us faisle se nikla hai: list
 * points ke GHATATE kram me aati hai, to upar se 5 kaat-te hi ghaate wale KABHI nahi
 * dikhte, aur wahi to dekhne the. Isliye har khambe ki kam se kam chaudai tay hai aur
 * zaroorat par chart bagal me sarakta hai. Laptop par sab ek saath aa jaate hain; phone
 * par ungli se sarka kar poori team — kisi ko chhupaya nahi jaata.
 *
 * RANG AKELA NISHAAN NAHI HAI: hare aur laal ka farak colour-blind (deutan) aankh ke liye
 * bahut kam hota hai (naapa gaya ΔE 7.3). Isliye DISHAA (lakeer ke upar/neeche) aur har
 * khambe ka apna aankda `+`/`−` ke saath — dono saath chalte hain. Inme se koi hata kar
 * "saaf" mat karna.
 *
 * Khambe par tap karne se wahi detail khulti hai jo list se khulti hai — roop badalne se
 * raasta nahi chhinna chahiye.
 */

// Bar wale hisse ki kul oonchai; isi me zero ki lakeer ke dono taraf ka hissa bantta hai.
const CHART_PX = 140;
// Kam se kam 3px — warna "1 point" aur "kuch nahi" ek jaise dikhte hain.
const MIN_BAR_PX = 3;
// Khamba itne se zyada chauda nahi hoga. Yahi sabak PointsTrend me pehle se likha hai: kam
// log hone par khambe phail kar blok ban jaate hain — do logon par 380px ke do chaukor ban
// rahe the, jo bar chart lagta hi nahi.
const BAR_MAX_W = 'max-w-16'; // 4rem
// Khambe ki kam se kam chaudai — NAAP KAR chuni gayi hai. 375px ke phone par: 8 khambon
// par 32px bachte the aur aadhe naam kat rahe the; 48px par bhi "Priyanshi" kat raha tha;
// 56px par 12 me se ek bhi naam nahi kat-ta. Jab chart sarak hi sakta hai to naam kaatne
// ki koi wajah nahi — thoda zyada sarkao, par sach poora dikhe.
const MIN_COL_PX = 56;

/** Khambe ke neeche sirf pehla naam — poora naam `title` me rehta hai. */
function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || name;
}

export function LeaderboardChart({ rows, onOpenPerson, className }) {
  // Zero par khade bande ka khamba hota hi nahi, bas jagah ghera rehti — unhe chhod do.
  // Wo Table wale roop me poore dikhte hain.
  //
  // KRAM ULTA HAI, aur ye jaan-boojh kar hai (owner, 26 Nov 2026): server list GHATATE kram
  // me bhejta hai (sabse zyada pehle), jo Table ke liye theek hai — rank 1 sabse upar. Par
  // khambon me aankh baayein se dayein chalti hai, aur badhti hui lakeer dekhne me seedhi
  // lagti hai: ghaata baayein kinare, sabse zyada kamai daayein. Table ka kram chhua nahi —
  // wahan rank 1 upar hi rehta hai.
  const list = (rows ?? []).filter((r) => Number(r.points)).slice().reverse();

  if (!list.length) {
    return (
      <p className={cn('py-10 text-center text-sm text-muted-foreground', className)}>
        Nobody has points this period.
      </p>
    );
  }

  const maxUp = Math.max(0, ...list.map((r) => Math.max(0, Number(r.points) || 0)));
  const maxDown = Math.max(0, ...list.map((r) => Math.max(0, -(Number(r.points) || 0))));
  const span = maxUp + maxDown || 1;
  // Lakeer data ke hisaab se baithti hai, beech me nahi: koi ghaate me na ho to wo bilkul
  // neeche hogi aur poori oonchai kamai ko milegi.
  const pxPerPoint = CHART_PX / span;
  const upperPx = Math.round(maxUp * pxPerPoint);
  const lowerPx = CHART_PX - upperPx;
  const barPx = (v) => (v > 0 ? Math.max(MIN_BAR_PX, Math.round(v * pxPerPoint)) : 0);

  return (
    <div className={cn('px-3 pb-3 pt-1', className)}>
      {/* Sarakne wali patti. Jab sab samaa jaate hain (laptop) tab ye kuch karti hi nahi. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div
          className="grid items-end gap-1 sm:gap-1.5"
          style={{ gridTemplateColumns: `repeat(${list.length}, minmax(${MIN_COL_PX}px, 1fr))` }}
        >
          {list.map((r) => {
            const p = Number(r.points) || 0;
            const title = `${r.name} — ${p > 0 ? `+${p}` : p}`;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpenPerson?.(r)}
                title={title}
                aria-label={title}
                className="group flex min-w-0 flex-col items-center rounded-md px-0.5 pb-1 pt-0.5 transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <span
                  className={cn(
                    'mb-1 w-full truncate text-center text-[9px] font-semibold tabular-nums sm:text-[10px]',
                    p > 0 ? 'text-success' : 'text-destructive',
                  )}
                >
                  {p > 0 ? `+${p}` : p}
                </span>

                {/* Jod ka hissa — bar NEECHE se badhta hai, isliye `items-end`. */}
                <span className="flex w-full items-end justify-center" style={{ height: `${upperPx}px` }}>
                  <span className={cn('w-full rounded-t-[3px] bg-success/80', BAR_MAX_W)} style={{ height: `${barPx(p)}px` }} />
                </span>

                {/* Zero ki lakeer — dono taraf ke bar isi se nikalte hain. */}
                <span className="h-px w-full bg-border" />

                {/* Ghaate ka hissa — bar UPAR se latakta hai. */}
                <span className="flex w-full items-start justify-center" style={{ height: `${lowerPx}px` }}>
                  <span className={cn('w-full rounded-b-[3px] bg-destructive/80', BAR_MAX_W)} style={{ height: `${barPx(-p)}px` }} />
                </span>

                <span className="mt-1 w-full truncate text-center text-[10px] text-muted-foreground">
                  {firstName(r.name)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
