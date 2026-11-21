'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { buildMonthGrid, monthLabel } from '@/lib/calendar';
import { effectiveStatus } from '@/lib/attendance';
import { attendanceStatusText } from './attendance-status-badge';
import { companyYMD, formatTime, formatDuration } from '@/lib/time';

/**
 * EK MAHINE KI SHAKL — ek nazar me.
 *
 * Dossier ke tile batate hain "Late: 4", aur neeche ki table ek-ek din. Par jo sawaal
 * leadership asal me poochhti hai — "ye char deri ek kharab hafte me padi, ya HAR Monday
 * ko padti hai" — uska jawab na ginti deti hai na table. Wo jawab shakl se milta hai,
 * isliye ye jaali.
 *
 * KYUN KALENDER WALA DHAANCHA, GitHub jaisi patti nahi: yahan har KHAMBA ek weekday hai
 * (Sun se Sat). Yaani "har Monday" ek poora khamba bankar dikhta hai — wahi cheez jo
 * dhoondhni hai. Patti me wo tedhi lakeer banti, jo padhne me mushkil hai.
 *
 * OWNER KE NIYAM (21 Nov 2026, pehla roop dekhne ke baad):
 *   1. Jaali card ki POORI chaudai bhare — pehle ek 272px ka dabba baayein baithta tha
 *      aur baaki card khaali rehta tha.
 *   2. Mahine ke SAARE din dikhein — 31, 30, 28 ya 29, jitne us mahine me hain. Pehle
 *      jis hafte me data nahi tha wo kaat diya jaata tha, to "This month" 21 par khatam
 *      ho jaata tha.
 *   3. Aane wale din KHAALI — koi rang nahi.
 *   4. Upar period badlo to jaali usi hisaab se bane — isliye mahine `from`/`to` se
 *      bante hain, rows se nahi (dekho `monthsInRange`).
 *
 * DATA KAHAN SE: dossier ka `attendance.days` — wahi array jo neeche ki table chhapti hai
 * (server par buildAttendanceDays banata hai). Koi naya request nahi, koi naya field nahi.
 * Isliye jaali aur table me farak ho hi nahi sakta.
 *
 * RANG APNE SE NAHI CHUNE: har khaane ka rang app ke wahi semantic token hain jo
 * status-badge use karta hai (--success, --info, --destructive, --primary, --muted,
 * --warning). Dark mode apne aap chalta hai, aur jaali ka hara wahi hara hai jo table ke
 * badge ka hai.
 *
 * DERI KO LAAL/AMBER KHAANA NAHI BANAYA — app ka niyam hai ki late aane wala bhi HAAZIR
 * hua, isliye wo "Present (late)" dikhta hai, akela darawna "Late" kabhi nahi
 * (attendance-status-badge.jsx). To khaana HARA rehta hai aur kone me ek chhota amber
 * nishaan lagta hai. Amber nishaan ek hi khambe me lagein to "har Monday" turant dikhta hai.
 *
 * LITE MODE: koi animation nahi — bas `transition-colors`, jise Lite mode sirf turant
 * kar deta hai (wahi chhoot bottom-nav me likhi hai).
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Khaane ka rang. `effectiveStatus` ke baad ka naam istemaal hota hai, to LATE+excused
// yahan ON_DUTY bankar aata hai (aur hara rehta hai — wo office ka kaam tha).
const CELL_TONE = {
  PRESENT: 'bg-success/20 text-success ring-success/30',
  ON_DUTY: 'bg-success/20 text-success ring-success/30',
  LATE: 'bg-success/20 text-success ring-success/30',
  WFH: 'bg-primary/18 text-primary ring-primary/30',
  ON_LEAVE: 'bg-info/20 text-info ring-info/30',
  // CHHUTTI KE TEENO DIN EK HI GREY — Sunday, company holiday aur janamdin. Holiday ko
  // pehle info/10 diya tha (badge ki tarah) par jaali me wo chhutti ke neele se milta tha;
  // badge ke saath LAFZ hota hai, jaali me sirf rang. Milane se kuch khota nahi: Sunday
  // hamesha SUN ke khambe me hota hai, to usse bahar ka grey holiday ya janamdin hai.
  HOLIDAY: 'bg-muted text-muted-foreground ring-border',
  BIRTHDAY: 'bg-muted text-muted-foreground ring-border',
  WEEKEND: 'bg-muted text-muted-foreground ring-border',
  ABSENT: 'bg-destructive/18 text-destructive ring-destructive/30',
  // Aaj ka din, banda abhi aaya nahi — bina bharaav, par SAAF kinara. Khaali din (neeche
  // BLANK_CELL) se alag dikhna zaroori hai, warna "aaj" aur "aane wala kal" ek jaise lagte.
  AWAITED: 'text-foreground/80 ring-muted-foreground/50',
  UPCOMING: 'text-foreground/80 ring-muted-foreground/50',
};

// Jis din ka koi record nahi — aane wala din, joining se pehle ka, ya chune hue period ke
// bahar ka. Owner ka niyam: KOI RANG NAHI. Sirf tareekh aur ek baal jaisa patla kinara,
// taaki mahine ka dhaancha (poore 28–31 din) bana rahe aur number hawa me na tairein.
const BLANK_CELL = 'text-muted-foreground/45 ring-border/35';

// Legend chhoti rakhne ke liye kuch status ek hi entry me aate hain.
const LEGEND = [
  { key: 'PRESENT', label: 'Present', covers: ['PRESENT', 'ON_DUTY', 'LATE'], swatch: 'bg-success/20 ring-success/30' },
  { key: 'WFH', label: 'From home', covers: ['WFH'], swatch: 'bg-primary/18 ring-primary/30' },
  { key: 'ON_LEAVE', label: 'On leave', covers: ['ON_LEAVE'], swatch: 'bg-info/20 ring-info/30' },
  { key: 'ABSENT', label: 'Absent', covers: ['ABSENT'], swatch: 'bg-destructive/18 ring-destructive/30' },
  { key: 'OFF', label: 'Day off', covers: ['WEEKEND', 'HOLIDAY', 'BIRTHDAY'], swatch: 'bg-muted ring-border' },
  { key: 'UPCOMING', label: 'Not in yet', covers: ['AWAITED', 'UPCOMING'], swatch: 'ring-muted-foreground/50' },
];

// Mahino ki kataar — kitne mahine hain uske hisaab se. Ek mahina ho to wo HAMESHA poori
// chaudai leta hai (owner ka niyam #1); zyada hon to card jitna chauda ho utne ek kataar
// me. Class ke poore naam yahan likhe hain kyunki Tailwind jode hue naam nahi pakadta.
//
// SCREEN NAHI, CARD KI CHAUDAI (`@container`) — dossier par laptop me sidebar hota hai aur
// tablet par nahi, to ek hi screen-chaudai par card ki chaudai alag hoti hai.
const MONTH_COLS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 @xl:grid-cols-2',
  many: 'grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-3',
};

// Itne se zyada mahine ek saath nahi banenge. App 1 Jul 2026 se chal raha hai, to aaj ye
// kabhi nahi chhuta — par kisi din koi bahut lamba custom range chune to page atak na jaaye.
const MAX_MONTHS = 36;

/** Ek khaane par kone ka nishaan: deri, ya aadhe din ki chhutti. */
function markOf(row) {
  // Deri pehle — pattern dhoondhne wali cheez wahi hai. Maaf ki hui deri (on duty) par
  // nishaan nahi: wo office ka kaam tha.
  if (row.status === 'LATE' && !row.excused) return 'late';
  if (row.halfDayLeave) return 'half';
  return null;
}

/** Ek khaane ki poori baat — hover ke `title` me aur neeche ki detail line me, dono me. */
function describe(row) {
  // `attendanceStatusText` "abhi aaye nahi" ke liye "—" deta hai. Table ke khaane me wo
  // theek hai, par ek poori line me akela dash kuch kehta hi nahi — isliye yahan lafz.
  const label = attendanceStatusText(row, row.status);
  const bits = [label === '—' ? 'Not in yet' : label];
  if (row.checkInAt) bits.push(`In ${formatTime(row.checkInAt)}`);
  if (row.checkOutAt) bits.push(`Out ${formatTime(row.checkOutAt)}`);
  if (row.workedMinutes) bits.push(`Worked ${formatDuration(row.workedMinutes)}`);
  if (row.overtimeMinutes) bits.push(`OT ${formatDuration(row.overtimeMinutes)}`);
  return bits.join(' · ');
}

function longDate(ymd) {
  // `new Date('YYYY-MM-DD')` ko browser UTC maanta hai, to timezone peechhe hone par
  // tareekh ek din khisak jaati hai. `T00:00:00` lagane se wo LOCAL padhi jaati hai.
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

/**
 * `from` se `to` tak ke saare mahine, purane se naye ki taraf.
 *
 * KYUN PERIOD SE, ROWS SE NAHI (owner ka niyam #4): pehle mahine rows se nikalte the —
 * yaani jis mahine me ek bhi row na ho wo gayab. Upar "Year" chuno aur kisi ka teen
 * mahine ka koi record na ho, to wo teen mahine jaali se chupchaap kat jaate, aur jaali
 * upar ke chune hue period se mel nahi khaati. Ab jo period chuna wahi mahine, hamesha.
 */
function monthsInRange(fromYMD, toYMD) {
  if (!fromYMD || !toYMD || fromYMD > toYMD) return { list: [], clipped: false };
  let y = Number(fromYMD.slice(0, 4));
  let m = Number(fromYMD.slice(5, 7)) - 1;
  const endY = Number(toYMD.slice(0, 4));
  const endM = Number(toYMD.slice(5, 7)) - 1;
  const list = [];
  while (y < endY || (y === endY && m <= endM)) {
    list.push({ key: `${y}-${String(m + 1).padStart(2, '0')}`, year: y, month: m });
    m += 1;
    if (m === 12) { m = 0; y += 1; }
  }
  // Bahut lamba ho to SABSE NAYE mahine rakho — wahi zyada kaam ke hain.
  return list.length > MAX_MONTHS ? { list: list.slice(-MAX_MONTHS), clipped: true } : { list, clipped: false };
}

/**
 * @param {object[]} days  dossier ka `attendance.days`
 * @param {string}   from  upar chuna hua period (YYYY-MM-DD) — isi se mahine bante hain
 * @param {string}   to
 */
export function AttendanceHeatmap({ days, from, to, className }) {
  const [picked, setPicked] = React.useState(null);
  const today = companyYMD(new Date());

  // dateYMD → row. AAGE KE DIN yahin se bahar: owner ka niyam hai ki aane wala din
  // khaali rahe, bina rang — chahe uske liye koi row ho (jaise pehle se manzoor chhutti).
  const byYMD = React.useMemo(() => {
    const map = new Map();
    for (const r of days ?? []) if (r?.dateYMD && r.dateYMD <= today) map.set(r.dateYMD, r);
    return map;
  }, [days, today]);

  const { list: months, clipped } = React.useMemo(() => {
    if (from && to) return monthsInRange(from, to);
    // `from`/`to` na mile to rows ki pehli-aakhri tareekh se — purana rasta, bas bachaav.
    const keys = [...byYMD.keys()].sort();
    return monthsInRange(keys[0], keys[keys.length - 1]);
  }, [from, to, byYMD]);

  const legend = React.useMemo(() => {
    const seen = new Set();
    let anyLate = false;
    let anyHalf = false;
    for (const r of byYMD.values()) {
      seen.add(effectiveStatus(r, r.status));
      const mk = markOf(r);
      if (mk === 'late') anyLate = true;
      if (mk === 'half') anyHalf = true;
    }
    return { items: LEGEND.filter((l) => l.covers.some((s) => seen.has(s))), anyLate, anyHalf };
  }, [byYMD]);

  if (!months.length) return null;

  const pickedRow = picked ? byYMD.get(picked) : null;
  const cols = MONTH_COLS[months.length] ?? MONTH_COLS.many;

  return (
    <div className={cn('@container rounded-2xl border border-border/50 bg-card/50 p-3 sm:p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm font-semibold">Month at a glance</p>
        {/* Sirf wo rang jo is period me sach me aaye — legend chhoti rehti hai. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
          {legend.items.map((l) => (
            <span key={l.key} className="inline-flex items-center gap-1.5">
              <span className={cn('size-3 rounded-[4px] ring-1 ring-inset', l.swatch)} />
              {l.label}
            </span>
          ))}
          {legend.anyLate ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="relative size-3 rounded-[4px] bg-success/20 ring-1 ring-inset ring-success/30">
                <span className="absolute right-px top-px size-1.5 rounded-full bg-warning" />
              </span>
              Late
            </span>
          ) : null}
          {legend.anyHalf ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="relative size-3 rounded-[4px] bg-success/20 ring-1 ring-inset ring-success/30">
                <span className="absolute right-px top-px size-1.5 rounded-full bg-info" />
              </span>
              Half day
            </span>
          ) : null}
        </div>
      </div>

      <div className={cn('mt-3 grid gap-x-6 gap-y-5', cols)}>
        {months.map(({ key, year, month }) => (
          <div key={key} className="min-w-0">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{monthLabel(year, month)}</p>
            {/* grid-cols-7 = repeat(7, minmax(0,1fr)) — saat barabar khambe; koi khaana
                apne number ki wajah se chauda nahi hota. */}
            <div className="grid grid-cols-7 gap-1 text-center @md:gap-1.5">
              {WEEKDAYS.map((d) => (
                <span key={d} className="pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {d}
                </span>
              ))}
              {buildMonthGrid(year, month).map((cell) => {
                // KHAANE KI NAAP: `aspect-square` + `max-h-14`. Patle khambe me (phone, ya
                // ek kataar me teen mahine) khaana chaukor rehta hai; chaude khambe me (ek
                // mahina poori chaudai par) oonchai 56px par ruk jaati hai aur khaana lamba
                // patta ban jaata hai. Warna laptop par ek mahina 150px ke chaukon se 900px
                // ooncha ho jaata.
                const box = 'relative grid aspect-square max-h-14 w-full place-items-center rounded-md text-[11px] font-medium tabular-nums @md:text-xs';
                // Mahine ke pehle/baad ke khaane — doosre mahine ke din, inme kuch nahi.
                if (!cell.inMonth) return <span key={cell.ymd} aria-hidden className="aspect-square max-h-14 w-full" />;
                const n = Number(cell.ymd.slice(8, 10));
                const row = byYMD.get(cell.ymd);
                if (!row) {
                  return (
                    <span key={cell.ymd} className={cn(box, 'ring-1 ring-inset', BLANK_CELL)}>
                      {n}
                    </span>
                  );
                }
                const s = effectiveStatus(row, row.status);
                const mark = markOf(row);
                const text = `${longDate(cell.ymd)} — ${describe(row)}`;
                return (
                  <button
                    key={cell.ymd}
                    type="button"
                    onClick={() => setPicked((p) => (p === cell.ymd ? null : cell.ymd))}
                    title={text}
                    aria-label={text}
                    aria-pressed={picked === cell.ymd}
                    className={cn(
                      box,
                      'ring-1 ring-inset transition-colors hover:ring-2',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                      CELL_TONE[s] ?? BLANK_CELL,
                      picked === cell.ymd && '!ring-2 !ring-primary',
                    )}
                  >
                    {n}
                    {mark ? (
                      <span
                        className={cn(
                          'absolute right-[3px] top-[3px] size-1.5 rounded-full',
                          mark === 'late' ? 'bg-warning' : 'bg-info',
                        )}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Phone par `title` ka hover hota hi nahi, to tap par poori baat yahan likhti hai.
          Ek hi line, taaki jaali apni jagah se na hile. */}
      <p className="mt-3 min-h-[1.25rem] text-xs text-muted-foreground">
        {pickedRow ? (
          <>
            <span className="font-medium text-foreground">{longDate(picked)}</span> · {describe(pickedRow)}
          </>
        ) : clipped ? (
          `Showing the latest ${MAX_MONTHS} months of this range. Tap a day for its times.`
        ) : (
          'Tap a day for its times.'
        )}
      </p>
    </div>
  );
}
