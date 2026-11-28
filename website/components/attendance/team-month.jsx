'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDuration, formatTime } from '@/lib/time';
import { attendanceStatusLabel } from '@/lib/attendance';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MARKS, cellStatus, dayTotals, foldRow, monthHeadline } from '@/lib/team-month';
import { QueryError } from '@/components/glass/query-error';

/**
 * POORA MAHINA, POORI TEAM — ek jaali: har banda ek kataar, har din ek khaana.
 *
 * Ye Day wale roop ka doosra roop NAHI hai, doosra SAWAAL hai. Ek din ka roster ye nahi
 * bata sakta ki "kaun baar-baar late hai" ya "kis din office khaali tha" — uske liye
 * poora mahina ek saath dikhna chahiye. Ek kataar me bikhre amber nishaan = ek bande ki
 * aadat; ek khambe me = us din poora office late tha (baarish, pichhli raat ka kaam).
 *
 * RANG WAHI HAIN JO TEAM-MEMBER PAGE KI JAALI KE HAIN (attendance-heatmap.jsx) — ek hi
 * app me ek hi cheez ke do rang nahi. Wahan ek bande ka mahina hai, yahan poori team ka.
 *
 * TILES YAHAN NAHI DIKHTE. Wo nau card EK DIN ginte hain; unke neeche poore mahine ki
 * jaali rakhte to "Late 2" ke neeche "Late 19" chhapta — ek hi lafz ke do jawab. Isliye
 * Day aur Month alag hain, aur Day hi default hai.
 *
 * KHAANE PAR TAP KYUN NAHI KHOLTA DIALOG: phone par khaana ~9px ka hai (naapa gaya), uspar
 * theek ungli rakhna mumkin hi nahi — koi bhi tap aas-paas ka din pakad lega. Isliye tap
 * karne par neeche ek line me poori baat likhti hai, aur usi line me ‹ › hain: mota-mota tap
 * karo, phir theek din par pahunch jao. Dono teer 36px ke hain, khaana 9px ka. Us din ko
 * poora dekhna ho to "Open" Day wale roop par le jaata hai.
 *
 * LITE MODE: koi animation nahi.
 */

// Wahi rang jo attendance-heatmap.jsx ke hain. `cellStatus` ke baad ka naam aata hai, to
// maaf ki hui deri yahan ON_DUTY bankar aati hai (aur hari rehti hai — wo office ka kaam tha).
const TONE = {
  PRESENT: 'bg-success/20 ring-success/30',
  ON_DUTY: 'bg-success/20 ring-success/30',
  LATE: 'bg-success/20 ring-success/30',
  WFH: 'bg-primary/18 ring-primary/30',
  ON_LEAVE: 'bg-info/20 ring-info/30',
  HOLIDAY: 'bg-muted ring-border',
  BIRTHDAY: 'bg-muted ring-border',
  WEEKEND: 'bg-muted ring-border',
  ABSENT: 'bg-destructive/18 ring-destructive/30',
  AWAITED: 'ring-muted-foreground/50',
  UPCOMING: 'ring-muted-foreground/50',
};
// Jis din ka koi faisla nahi — aane wala, ya joining se pehle.
const BLANK = 'ring-border/35';

const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const dowOf = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const dayNum = (ymd) => Number(ymd.slice(8, 10));
const longDate = (ymd) =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// Naam ka khamba aur dayein ki ginti — har kataar ek hi naap par, warna khaane line se hat jaate.
const GRID = 'grid-cols-[minmax(0,1fr)_auto] @2xl:grid-cols-[10rem_minmax(0,1fr)_4.5rem]';

const CHIPS = [
  { key: 'late', label: 'Late', swatch: 'bg-warning' },
  { key: 'open', label: 'No check-out', swatch: 'bg-success/60' },
  { key: 'absent', label: 'Absent', swatch: 'bg-destructive/50' },
  { key: 'leave', label: 'On leave', swatch: 'bg-info/50' },
  { key: 'wfh', label: 'From home', swatch: 'bg-primary/50' },
];

/**
 * Khaane ka chhota nishaan: deri (amber) ya aadha din (neela).
 *
 * Nishaan khaane ke BEECH me baithta hai, kone me nahi (owner, 28 Nov 2026). Kone me wo
 * khaane ki apni kinaari se chipka hua lagta tha — khaas kar bagal wale khaane ke saath,
 * jahan do nishaan paas-paas aa jaate the. Beech me aankh use khaane ka hissa padhti hai.
 */
function markOf(c) {
  if (MARKS.late(c)) return 'bg-warning';
  if (c?.hd) return 'bg-info';
  return null;
}

/** `withDate` false karne par tareekh nahi aati — phone par wo apni hi kataar me alag likhti hai. */
function describe(c, ymd, withDate = true) {
  if (!c) return 'Nothing recorded';
  const s = cellStatus(c);
  const bits = [attendanceStatusLabel(s) === '—' ? 'Not in yet' : attendanceStatusLabel(s)];
  if (MARKS.late(c)) bits[0] = 'Present (late)';
  if (c.hd) bits.push('Half day');
  if (c.od) bits.push('Worked on a day off');
  if (c.in) bits.push(`In ${formatTime(c.in)}`);
  if (c.out) bits.push(`Out ${formatTime(c.out)}`);
  else if (c.in) bits.push('No check-out');
  if (c.w) bits.push(`Worked ${formatDuration(c.w)}`);
  if (c.ot) bits.push(`Overtime ${formatDuration(c.ot)}`);
  return withDate ? `${longDate(ymd)} — ${bits.join(' · ')}` : bits.join(' · ');
}

/**
 * Us din kitne log AAYE — ginti upar, khamba neeche, jaali ke usi khambon par.
 *
 * GINTI KHAMBE KE UPAR HAI, ANDAR NAHI (owner ne andar poocha tha, 24 Nov 2026): khamba
 * `bg-foreground/25` hai, yaani halka grey. Uspar `text-foreground` light mode me to padh
 * aata hai par dark mode me ujla-par-ujla ho jaata hai, aur ulta rang (`text-background`)
 * light mode me safed-par-safed. Upar rakhne se dono theme me ek hi rang chalta hai aur
 * chhote khambe par bhi ginti kat-ti nahi. Khambe ko 40px par rok kar ginti ke liye apni
 * 14px ki kataar rakhi hai, to ginti kabhi khambe par nahi chadhti.
 *
 * GINTI SIRF CHAUDE CARD PAR, aur hadd naap kar chuni gayi hai. Teen jagah naapa:
 *   • phone, card 343px  → khamba 9.0px.  Ank 5.2px ka samaa to jaata hai, par beech me 3.8px
 *     bachte hain, to poori kataar "80999999289890" jaisi EK LAMBI SANKHYA bun jaati hai
 *     (screenshot le kar dekha). Aur "11" 10.4px ka hai — wo khaane se bahar hi nikal jaata.
 *   • tablet, card 710px → khamba 12.3px. "11" 11.7px ka — sirf 0.6px bachta hai, yaani do
 *     ank chipak jaate hain. (Card 672px par naam aur "in/due" ke khambe 232px le lete hain,
 *     isliye chaudai badhne par bhi khambe turant chaude nahi hote.)
 *   • laptop, card 1050px → khamba 23.9px. "11" ke baad 12px khaali — yahan padhne me aaram.
 *
 * Isliye hadd @3xl (card 768px) hai. Usse chhote par ginti KHOYI nahi jaati — kisi bhi din
 * par tap karo, neeche wali line "9 of 10 in that day" bata deti hai.
 *
 * TEEN ALAG HAALAT, TEEN ALAG SHAKL:
 *   • Us din kisi ko aana hi nahi tha (Sunday / company holiday) — kuch nahi, khaali khamba.
 *   • Aana tha par koi nahi aaya — khamba nahi, par ek feeka "0". Ye farak zaroori hai:
 *     "office band tha" aur "office khula tha, koi nahi aaya" ek jaise nahi dikhne chahiye.
 *   • Koi aaya — ginti aur khamba.
 *   • AANE WALA din — kuch nahi, chahe us din ka record ho (pehle se manzoor chhutti). Us din
 *     abhi koi aa hi nahi sakta tha, to "0" likhna jhooth hota.
 *
 * PEHLE 0 PAR BHI KHAMBA BAN RAHA THA: `Math.max(8, ...)` wali kam-se-kam oonchai 1 bande ke
 * liye rakhi thi, par wo 0 par bhi lag jaati thi — 16 Oct (1 banda) 4px ka aur 17 Oct (0 log)
 * 3px ka, dono ek jaise. Ab farsh sirf tab lagta hai jab koi sach me aaya ho.
 */
function DayBars({ totals, max }) {
  return (
    <span aria-hidden className="block">
      {/* Ginti. Phone par khamba ~9px chauda hota hai, to wahan 8px ka ank — "11" bhi samaa
          jaata hai (naapa gaya). Chaude card par 9px. */}
      <span className="hidden h-3.5 items-end gap-px @3xl:flex">
        {totals.map((d) => (
          <span
            key={d.ymd}
            className={cn(
              'min-w-0 flex-1 text-center text-[9px] font-semibold leading-none tabular-nums',
              d.came ? 'text-foreground' : 'text-muted-foreground/60',
            )}
          >
            {d.due && d.past ? d.came : ''}
          </span>
        ))}
      </span>
      <span className="flex h-10 items-end gap-px @3xl:mt-0.5">
        {totals.map((d) => (
          <span key={d.ymd} className="flex min-w-0 flex-1 items-end" style={{ height: '100%' }}>
            {d.came ? (
              <span
                className="w-full rounded-t-[2px] bg-foreground/25"
                // Kam se kam 8% — warna 11 me se 1 banda 4px ka ho kar gayab ho jaata hai.
                style={{ height: `${Math.max(8, Math.round((d.came / max) * 100))}%` }}
              />
            ) : null}
          </span>
        ))}
      </span>
    </span>
  );
}

export function TeamMonth({ monthKey, onOpenDay }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['attendance', 'month', monthKey],
    queryFn: () => api.get(`/attendance/month?month=${monthKey}`),
    staleTime: 60 * 1000,
  });

  const [chip, setChip] = React.useState(null);
  const [picked, setPicked] = React.useState(null); // { ri, ci }

  const view = React.useMemo(() => {
    if (!data?.rows) return null;
    const { rows, days, today } = data;
    const totals = dayTotals(rows, days, today);
    const max = Math.max(1, ...totals.map((d) => d.due));
    const folded = rows.map((r) => ({ ...r, t: foldRow(r) }));
    const head = monthHeadline(rows, days, today);
    // Chip laga ho to jiske paas wo nishaan hai wahi upar — list khud jawab de deti hai.
    const sorted = chip
      ? [...folded].sort((a, b) => (b.t[chip] || 0) - (a.t[chip] || 0) || a.user.name.localeCompare(b.user.name))
      : folded;
    return { ...data, totals, max, rows: sorted, head };
  }, [data, chip]);

  if (isError) return <QueryError title="Couldn’t load the month" error={error} onRetry={refetch} />;
  if (isLoading || !view) {
    return (
      <div className="glass glass-highlight rounded-2xl p-3">
        <p className="py-16 text-center text-sm text-muted-foreground">Loading the month…</p>
      </div>
    );
  }

  const { days, today, rows, totals, max, head, joinedLater } = view;
  const pickedCell = picked ? rows[picked.ri]?.cells[picked.ci] : null;
  const pickedYMD = picked ? days[picked.ci] : null;
  // Us poore DIN ki ginti — phone par ginti wali kataar chhupi hoti hai, to "us din kitne
  // aaye" ka jawab yahi ek jagah bachti hai.
  const pickedDay = picked ? totals[picked.ci] : null;
  // Usi kataar me ek din idhar-udhar. Mahine ke sire par ruk jaata hai.
  const step = (n) => setPicked((p) => (p ? { ...p, ci: Math.min(days.length - 1, Math.max(0, p.ci + n)) } : p));

  return (
    <div className="glass glass-highlight @container overflow-hidden rounded-2xl">
      {/* Ek line ka nichod — jaali padhne se pehle hi do jawab de deti hai. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border/60 px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
        {head.late.length ? (
          <span>
            Most late:{' '}
            <span className="font-medium text-foreground">
              {head.late.slice(0, 2).map((p) => `${p.row.user.name.split(' ')[0]} ${p.t.late}`).join(', ')}
            </span>
          </span>
        ) : (
          <span>Nobody was late this month.</span>
        )}
        {head.open.length ? (
          <span>
            Forgot check-out:{' '}
            <span className="font-medium text-foreground">
              {head.open.slice(0, 2).map((p) => `${p.row.user.name.split(' ')[0]} ${p.t.open}`).join(', ')}
            </span>
          </span>
        ) : null}
        {head.thin ? (
          <span>
            Fewest in:{' '}
            <span className="font-medium text-foreground">
              {longDate(head.thin.ymd)} — {head.thin.came} of {head.thin.due}
            </span>
          </span>
        ) : null}
      </div>

      {/* Chip = legend AUR chhanni, dono. Dabane par wo nishaan ujagar hota hai aur jinke
          paas sabse zyada hai wo log upar aa jaate hain. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-3 py-2 sm:px-4">
        <button
          type="button"
          onClick={() => setChip(null)}
          aria-pressed={chip === null}
          className={cn(
            'inline-flex min-h-9 items-center rounded-lg px-2.5 text-xs font-medium ring-1 transition-colors sm:min-h-0 sm:py-1',
            chip === null ? 'bg-primary/12 text-primary ring-primary/30' : 'text-muted-foreground ring-border hover:text-foreground',
          )}
        >
          All days
        </button>
        {CHIPS.map((c) => {
          const n = rows.reduce((s, r) => s + (r.t[c.key] || 0), 0);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setChip((v) => (v === c.key ? null : c.key))}
              aria-pressed={chip === c.key}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ring-1 transition-colors sm:min-h-0 sm:py-1',
                chip === c.key ? 'bg-primary/12 text-primary ring-primary/30' : 'text-muted-foreground ring-border hover:text-foreground',
              )}
            >
              <span className={cn('size-2.5 rounded-[3px]', c.swatch)} />
              {c.label} <span className="tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="p-2 sm:p-3">
        {/* Upar ki do kataar: kitne aaye, aur tareekh. Khambe neeche ki jaali se mel khate
            hain, isliye teenon ek hi grid par hain. */}
        <div className={cn('grid items-end gap-x-3 px-2', GRID)}>
          {/* `self-start` aur ye padding: bars aur tareekh dono EK hi khaane me hain, aur grid
              `items-end` par hai — to label neeche gir kar TAREEKHON ke bagal baith jaata tha,
              yaani wo unka naam lagta tha. pt se wo ginti+khambe ke saamne aa jaata hai. */}
          {/* Label bhi ginti ke saath aata hai — bina ginti ke wo sirf khambon ka naam hai,
              aur wo @2xl par bhi theek padhta hai. */}
          <span className="hidden self-start text-[10px] uppercase tracking-wide text-muted-foreground @2xl:block @3xl:pt-5">
            People in
          </span>
          <span className="col-span-2 @2xl:col-span-1">
            <DayBars totals={totals} max={max} />
            <span aria-hidden className="mt-1 flex gap-px">
              {days.map((ymd) => {
                const d = dowOf(ymd);
                const isToday = ymd === today;
                return (
                  <span
                    key={ymd}
                    className={cn(
                      'min-w-0 flex-1 text-center text-[9px] leading-tight tabular-nums',
                      isToday ? 'font-semibold text-primary' : d === 0 ? 'text-muted-foreground/50' : 'text-muted-foreground',
                    )}
                  >
                    <span className="block">{WD[d]}</span>
                    <span className="block @md:hidden">{dayNum(ymd) % 5 === 0 || dayNum(ymd) === 1 ? dayNum(ymd) : ' '}</span>
                    <span className="hidden @md:block">{dayNum(ymd)}</span>
                  </span>
                );
              })}
            </span>
          </span>
          {/* Pehle "due" tha — owner ko uljhan bhara laga (24 Nov 2026), wo "baaki hai" jaisa
              padhta hai jabki matlab hai "us bande ke kaam ke din". "Workdays" saaf tha par itna
              lamba ki khamba 96px le leta tha aur jaali ke din patle pad jaate the; isliye "WD",
              aur uska matlab neeche footnote me. */}
          <span className="hidden text-right text-[10px] uppercase tracking-wide text-muted-foreground @2xl:block">In / WD</span>
        </div>

        <ul className="mt-1">
          {rows.map((r, ri) => (
            <li key={r.user.id} className={cn('grid items-center gap-x-3 border-b border-border/40 px-2 py-1.5 last:border-0', GRID)}>
              <Link
                href={`/users/${r.user.id}`}
                className="min-w-0 truncate text-xs font-medium hover:underline @2xl:text-sm"
                title={r.user.name}
              >
                {r.user.name}
              </Link>
              {/* Phone par ginti naam ke bagal me, jaali uske neeche poori chaudai me. */}
              <span className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground @2xl:hidden">
                {r.t.in} / {r.t.due}
                {chip && r.t[chip] ? <span className="ml-1.5 font-semibold text-primary">{r.t[chip]}</span> : null}
              </span>
              <span className="col-span-2 mt-1 flex gap-px @2xl:col-span-1 @2xl:mt-0">
                {r.cells.map((c, ci) => {
                  const ymd = days[ci];
                  const s = cellStatus(c);
                  const mark = markOf(c);
                  const on = picked?.ri === ri && picked?.ci === ci;
                  // Chip laga ho to jo khaane us nishaan ke nahi wo peechhe chale jaate hain
                  // (gayab nahi — mahine ka dhaancha bana rehna chahiye).
                  const dim = chip && !MARKS[chip](c);
                  const text = `${r.user.name}: ${describe(c, ymd)}`;
                  return (
                    <button
                      key={ymd}
                      type="button"
                      onClick={() => setPicked((p) => (p?.ri === ri && p?.ci === ci ? null : { ri, ci }))}
                      title={text}
                      aria-label={text}
                      aria-pressed={on}
                      className={cn(
                        'relative h-5 min-w-0 flex-1 rounded-[3px] ring-1 ring-inset transition-colors @2xl:h-6',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        TONE[s] ?? BLANK,
                        dim && 'opacity-25',
                        on && '!ring-2 !ring-primary',
                      )}
                    >
                      {mark ? (
                        <span className={cn('absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full @2xl:size-1.5', mark, dim && 'opacity-0')} />
                      ) : null}
                    </button>
                  );
                })}
              </span>
              <span className="hidden text-right text-xs tabular-nums @2xl:block">
                {chip ? (
                  <span className={cn('font-semibold', r.t[chip] ? 'text-primary' : 'text-muted-foreground/50')}>{r.t[chip] || 0}</span>
                ) : (
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground">{r.t.in}</span> / {r.t.due}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        {/* Tap par poori baat.

            PHONE PAR DO KATAAR, CHAUDE PAR EK (owner, 24 Nov 2026). Pehle teeno cheezein ek hi
            kataar me thin: teer, poora matn, aur "Open Sun 15 Nov" ka button. Phone par matn ke
            liye beech me sirf ~120px bachte the, to wo PAANCH line me tut kar bura dikhta tha.

            Ab `order` + `basis-full` se phone par pehli kataar me teer, tareekh aur button rehte
            hain, aur poora matn neeche apni poori chaudai me. @2xl par sab wapas ek kataar me.
            Tareekh ab matn se nikaal kar teeron ke bagal rakhi hai — teer usi ko aage-peechhe
            karte hain, to wo wahin padhni chahiye. */}
        <div className="mt-2 flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 px-2 text-xs text-muted-foreground">
          {picked ? (
            <>
              {/* 9px ke khaane par ungli theek nahi padti — in do teeron se din sudhar jaata hai. */}
              <span className="order-1 flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => step(-1)}
                  disabled={picked.ci === 0}
                  aria-label="Previous day"
                  className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/10 disabled:opacity-30 sm:size-7"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  disabled={picked.ci === days.length - 1}
                  aria-label="Next day"
                  className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/10 disabled:opacity-30 sm:size-7"
                >
                  <ChevronRight className="size-4" />
                </button>
              </span>
              <span className="order-2 shrink-0 font-medium text-foreground">{longDate(pickedYMD)}</span>
              <button
                type="button"
                onClick={() => onOpenDay?.(pickedYMD)}
                className="order-3 ml-auto inline-flex min-h-9 shrink-0 items-center rounded-lg px-2.5 text-xs font-medium text-primary ring-1 ring-primary/30 hover:bg-primary/10 @2xl:order-4 sm:min-h-0 sm:py-1"
              >
                Open day
              </button>
              {/* basis-full = phone par apni poori kataar; @2xl par wapas beech me. */}
              <span className="order-4 min-w-0 basis-full @2xl:order-3 @2xl:flex-1 @2xl:basis-auto">
                <span className="font-medium text-foreground">{rows[picked.ri].user.name}</span> — {describe(pickedCell, pickedYMD, false)}
                {pickedDay?.due ? (
                  <>
                    {' · '}
                    <span className="font-medium text-foreground">{pickedDay.came} of {pickedDay.due}</span> in that day
                  </>
                ) : null}
              </span>
            </>
          ) : (
            <span>Tap any day for its times. Tap a name for that person’s page.</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground sm:px-4">
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-success/20 ring-1 ring-inset ring-success/30" /> At work</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-primary/18 ring-1 ring-inset ring-primary/30" /> From home</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-info/20 ring-1 ring-inset ring-info/30" /> On leave</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-destructive/18 ring-1 ring-inset ring-destructive/30" /> Absent</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-muted ring-1 ring-inset ring-border" /> Day off</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="relative size-3 rounded-[3px] bg-success/20 ring-1 ring-inset ring-success/30">
            <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-warning" />
          </span>
          Late
        </span>
        {/* Neela dot — jaali me ye pehle se dikhta tha par legend me likha hi nahi tha
            (owner, 28 Nov 2026): banda aadha din aaya, aadhe din ki chhutti. Khaana hara
            hi rehta hai (wo aaya to tha), isliye namoona bhi hara hai — baat dot ki hai.
            Shabd wahi jo khaane ki tooltip me hai ('Half day'), warna ek hi cheez do naam
            se dikhti. */}
        <span className="inline-flex items-center gap-1.5">
          <span className="relative size-3 rounded-[3px] bg-success/20 ring-1 ring-inset ring-success/30">
            <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-info" />
          </span>
          Half day
        </span>
        <span><span className="font-medium text-foreground">WD = workdays</span> — it leaves out Sundays, holidays and each person’s own days off.</span>
      </div>

      {joinedLater?.length ? (
        <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground sm:px-4">
          Not listed — they hadn’t joined yet: {joinedLater.map((p) => p.name).join(', ')}.
        </p>
      ) : null}
    </div>
  );
}
