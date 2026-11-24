'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { useSettings } from '@/lib/settings';
import { effectiveStatus } from '@/lib/attendance';
import { companyYMD, formatTime, formatDuration } from '@/lib/time';
import { axisFor, hmToMin, minToHM, pct, shapeRow, sortShapes } from '@/lib/day-timeline';
import { attendanceStatusText } from './attendance-status-badge';

/**
 * POORA DIN EK NAZAR ME — Everyone tab ka "Timeline" roop (owner ne poocha, 23 Nov 2026:
 * "table bhi dikhe or switch krke visually bhi dekh sake").
 *
 * KYUN TIMELINE, DONUT YA PIE NAHI: kitne log aaye / late / chhutti par — ye ginti isi tab
 * ke nau card bhi dikhate hain aur dashboard ka donut bhi. Wahi ginti teesri baar banti to
 * kuch naya pata nahi chalta. Jo baat na card batate hain na table, wo ye hai: KAUN KAB SE
 * KAB TAK tha. Wo shakl se dikhti hai — kaun der se aaya aur kitna, kaun pehle chala gaya,
 * kis waqt office bhara tha, kaun shaam tak ruka.
 *
 * DATA WAHI `rows` JO TABLE CHHAPTI HAI — koi naya request nahi, koi naya field nahi. Waqt
 * ka saara hisaab lib/day-timeline.js me hai; wahi teen niyam likhe hain jinse tasveer aur
 * table kabhi alag nahi bolti.
 *
 * HAR BANDE KI APNI SHIFT: office 10–6 hai par paanch logon ke ghante alag hain, isliye
 * "10 baje" ki ek lakeer sab par lagana galat hota. Halki grey patti usi bande ki shift hai;
 * bar us patti ke bahar daayein nikle to wo ruka, patti daayein khaali bache to pehle gaya.
 *
 * DERI KO LAAL/AMBER KHAMBA NAHI BANAYA — app ka niyam hai ki late aane wala bhi HAAZIR hua
 * (attendance-status-badge.jsx). Bar hara hi rehta hai; aane ke waqt aur aane ke beech sirf
 * ek patli amber lakeer, jiski LAMBAI batati hai kitni der.
 *
 * GHAR SE KAAM AUR CHHUTTI RANG SE ALAG NAHI DIKHTE — indigo aur neela itne paas hain ki
 * script se naapne par dark me ΔE 11 nikla (15 se kam = poori nazar wale ko bhi mushkil).
 * Isliye farq SHAKL se hai: jisne kaam kiya wo BHARA hua, jo nahi aaya wo KHAALI khaana. Aur
 * har row par haalat LAFZ me bhi likhi hai — rang akela kabhi nahi.
 *
 * LITE MODE: koi animation nahi.
 */

// Peechhe ki pattiyan. Bhara = kaam kiya (bina waqt ke); khaali kinara = nahi aaya.
const BAND = {
  due: 'bg-foreground/[0.11]',
  wfh: 'bg-primary/30 ring-1 ring-inset ring-primary/50',
  leave: 'ring-1 ring-inset ring-info/80',
  absent: 'ring-1 ring-inset ring-destructive/75',
  awaited: 'ring-1 ring-inset ring-muted-foreground/55',
};

// Overtime ka rang alag nahi, usi hare ka GEHRA roop — foreground milane se light me gehra
// aur dark me ujla hota hai, yaani dono me "zyada". Alag rang dete to wo alag cheez lagti.
// OKLAB, oklch nahi: oklch hue ko bhi ghumata hai (hara 154° se foreground ke neele 256° ki
// taraf), to dark me overtime CYAN ban jaata tha. oklab me hue apni jagah rehta hai.
const OT_FILL = 'bg-[color-mix(in_oklab,var(--success)_60%,var(--foreground))]';

// Card jitna chauda ho us hisaab se — phone par naam upar aur bar neeche, chaude card me ek
// hi kataar. Screen nahi CARD ki chaudai (`@container`): laptop par sidebar jagah leta hai.
const ROW_GRID = '@2xl:grid-cols-[11.5rem_minmax(0,1fr)_5.5rem] @2xl:items-center';

// BAR PATTI SE PATLA HAI (10 ke muqable 16px) — jaan-boojh kar. Barabar mota hota to der
// tak rukne wale ka bar apni hi shift ke ant ko dhak leta, aur "shift ke baad kitna ruka"
// dikhna hi band ho jaata.
const BAR_H = 'h-2.5';
const BAND_H = 'h-4';

/** Row ki haalat lafz me — wahi lafz jo table ke badge me hain. */
function stateText(s) {
  // Aadhe din ki chhutti aur doosra aadha laga hi nahi: table me do badge hote hain ("—" aur
  // "Half day"), jo ek line me "— Half day" ban jaate — bemaani. Yahan saaf lafz.
  if (s.half && !s.came) return s.isToday ? 'Half day · not in yet' : 'Half day · no check-in';
  const label = attendanceStatusText(s.row.attendance, s.row.status);
  // Table ke khaane me akela dash chal jaata hai; yahan poora lafz chahiye. "due 11:00" se ek
  // nazar me alag ho jaata hai ki kiska waqt nikal gaya aur kiski shift abhi shuru hi nahi hui —
  // card ka "Not in yet" dono ko ek jaisa ginta hai.
  if (label && label !== '—') return label;
  return s.shift && !s.off ? `Not in yet · due ${minToHM(s.dueFrom)}` : 'Not in yet';
}

function timesText(s) {
  const a = s.row.attendance;
  if (s.came) {
    const from = formatTime(a.checkInAt);
    // badOut: jaana aane se pehle likha hai. Bar nahi banta, par dono waqt jaise hain waise likho.
    if (s.outMin != null || s.badOut) return `${from} – ${formatTime(a.checkOutAt)}`;
    // "still in" nahi likha: pata sirf itna hai ki check-out NAHI HUA. Har aathva banda
    // bhool jaata hai, to "andar hai" kehna ek daava hota.
    return s.running ? `${from} – not out yet` : `${from} – no check-out`;
  }
  // Check-out hai par check-in nahi (haath se bhari adhoori entry). Haalat ka lafz PEHLE —
  // sirf waqt likhne par "On leave" wala banda bhi hazir jaisa padha jaata.
  if (s.outMin != null) return `${stateText(s)} · out ${formatTime(a.checkOutAt)}`;
  return null;
}

/** Hover aur screen-reader ke liye poori baat, ek line me. */
function fullText(s) {
  const a = s.row.attendance;
  const t = timesText(s);
  // Aaye hue bande par haalat + waqt; baaki par timesText khud haalat se shuru hota hai.
  const bits = s.came ? [stateText(s), t] : [t ?? stateText(s)];
  if (s.came && s.outMin != null && a?.workedMinutes) bits.push(`Worked ${formatDuration(a.workedMinutes)}`);
  if (a?.overtimeMinutes) bits.push(`Overtime ${formatDuration(a.overtimeMinutes)}`);
  if (s.shift && !s.off) bits.push(`Shift ${minToHM(s.shift.start)}–${minToHM(s.shift.end)}`);
  // Row par "· Selfie" dikhta hai, par `aria-label` andar ka saara matn badal deta hai — iske
  // bina screen-reader aur hover dono me ye baat gayab thi.
  if (a?.checkInMeta?.selfieKey || a?.checkOutMeta?.selfieKey) bits.push('Selfie check-in');
  return `${s.row.user.name}: ${bits.join(' · ')}`;
}

function Track({ s, axis, asOfMin }) {
  const span = (from, to) => ({ left: `${pct(from, axis)}%`, width: `${Math.max(0, pct(to, axis) - pct(from, axis))}%` });
  const bar = s.bar;
  // Bar ka seedha hissa OT se pehle tak; uske baad 2px ki jhirri aur phir gehra OT.
  const plainTo = s.ot ? s.ot.from : bar?.to;
  return (
    <span aria-hidden className="relative block h-5 w-full">
      {axis.ticks.map((t) => (
        <span key={t.min} className="absolute inset-y-0 w-px bg-border/50" style={{ left: `${pct(t.min, axis)}%` }} />
      ))}
      {s.bands.map((b) => (
        <span key={`${b.kind}-${b.from}`} className={cn('absolute top-1/2 -translate-y-1/2 rounded', BAND_H, BAND[b.kind])} style={span(b.from, b.to)} />
      ))}
      {/* minWidth: ek minute ki deri 480-minute ke paimane par 0.7px banti hai, yaani dikhti hi
          nahi — aur ek minute ki deri bhi deri hai (grace 0 ho to 10:01 bhi LATE hai). Baaki har
          nishaan ki apni kam-se-kam chaudai hai; sirf yahi chhoot gayi thi. */}
      {s.late ? (
        <span
          className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-warning"
          style={{ ...span(s.late.from, s.late.to), minWidth: '3px' }}
        />
      ) : null}
      {/* `|| !s.ot` ke bina SHOONYA lambai wala bar gayab ho jaata tha: check-in aur check-out
          ek hi waqt par (leadership ne dono me ek hi waqt daal diya, ya banda aaya aur turant
          chala gaya) — table "Present" kehti par tasveer me kuch hota hi nahi tha. Wahi haal
          abhi-abhi check-in karne par ek minute tak hota tha, kyunki "As of" poore minute me
          hai aur check-in me second bhi hain. Jahan OT poore bar par phaila hai (chhutti ke din
          ka kaam) wahan `s.ot` laga hota hai, to wo pehle jaisa hi chhoot jaata hai. */}
      {bar && bar.to != null && (plainTo > bar.from || !s.ot) ? (
        <span
          className={cn('absolute top-1/2 -translate-y-1/2 bg-success', BAR_H, s.ot || s.running ? 'rounded-l' : 'rounded')}
          // 2px se patla bar dikhta hi nahi — abhi-abhi aaye bande ka bhi nishaan rahe.
          style={{ ...span(bar.from, plainTo), minWidth: '3px' }}
        />
      ) : null}
      {s.ot ? (
        <span
          className={cn('absolute top-1/2 -translate-y-1/2', BAR_H, OT_FILL, s.ot.from > bar.from ? 'rounded-r' : 'rounded')}
          style={{
            left: `calc(${pct(s.ot.from, axis)}% + ${s.ot.from > bar.from ? 2 : 0}px)`,
            width: `max(2px, calc(${pct(s.ot.to, axis) - pct(s.ot.from, axis)}% - ${s.ot.from > bar.from ? 2 : 0}px))`,
          }}
        />
      ) : null}
      {/* Purana din, check-out nahi: kab gaya ye PATA NAHI, to ant gadha nahi jaata — sirf
          aane ka nishaan, aage ghulta hua. */}
      {/* Chaudai paimane me BACHI jagah se bandhi hai: 17:55 par aaye bande ka nishaan 99% par
          baithta hai, aur pakki 28px wahan se nikal kar bagal ke "Worked" khambe ke neeche aur
          card ke kinare tak chali jaati thi — ghulti hui lakeer ka ant ek kati hui seedhi lakeer
          bun jaata, jo iske matlab ka ulta hai. */}
      {bar && bar.to == null ? (
        <span
          className={cn('absolute top-1/2 -translate-y-1/2 rounded-l bg-gradient-to-r from-success to-transparent', BAR_H)}
          style={{ left: `${pct(bar.from, axis)}%`, width: `min(1.75rem, ${100 - pct(bar.from, axis)}%)` }}
        />
      ) : null}
      {!s.came && s.outMin != null ? (
        <span className={cn('absolute top-1/2 w-[3px] -translate-y-1/2 rounded-full bg-success', BAND_H)} style={{ left: `${pct(s.outMin, axis)}%` }} />
      ) : null}
      {asOfMin != null && asOfMin >= axis.from && asOfMin <= axis.to ? (
        <span className="absolute -inset-y-2 w-px bg-primary/70" style={{ left: `${pct(asOfMin, axis)}%` }} />
      ) : null}
    </span>
  );
}

/**
 * Ghante ke ank. Patle card par sirf "10", chaude par "10:00" — phone par poora ank kinare
 * ke ank se takra jaata tha. "As of" ka waqt yahan NAHI: wo har minute alag jagah hota, to
 * kisi na kisi ghante ke ank par chadhta hi; uski lakeer har row me hai aur lafz legend me.
 */
function Axis({ axis }) {
  return (
    <span aria-hidden className="relative block h-4 w-full text-[10px] tabular-nums text-muted-foreground">
      {axis.ticks.map((t) =>
        t.label ? (
          <span
            key={t.min}
            className={cn(
              'absolute top-0',
              t.min === axis.from ? '' : t.min === axis.to ? '-translate-x-full' : '-translate-x-1/2',
            )}
            style={{ left: `${pct(t.min, axis)}%` }}
          >
            <span className="@md:hidden">{t.label.slice(0, 2)}</span>
            <span className="hidden @md:inline">{t.label}</span>
          </span>
        ) : null,
      )}
    </span>
  );
}

const LEGEND = [
  { key: 'in', label: 'At work', swatch: 'bg-success', show: (s) => s.came },
  { key: 'ot', label: 'Overtime', swatch: OT_FILL, show: (s) => !!s.ot },
  { key: 'late', label: 'Late arrival', swatch: null, line: true, show: (s) => !!s.late },
  // Purane din par bhi shift AAJ ki hi hoti hai (ghanton ka itihaas kahin nahi rakha jaata) —
  // legend ye khud bol deti hai.
  { key: 'due', label: 'Shift hours', pastLabel: 'Shift hours (as set now)', swatch: BAND.due, show: (s) => s.bands.some((b) => b.kind === 'due') },
  // Shart WAHI jo nishaan banati hai (`bar.to == null`), `open` nahi: jis purani row par
  // check-out check-in se PEHLE ka likha hai wahan bhi yahi ghulti lakeer banti hai par `open`
  // false hota hai — to legend us nishaan ko bina naam ke chhod deti thi.
  { key: 'open', label: 'No check-out', swatch: 'bg-gradient-to-r from-success to-transparent', show: (s) => s.bar != null && s.bar.to == null },
  { key: 'wfh', label: 'Work from home', swatch: BAND.wfh, show: (s) => s.bands.some((b) => b.kind === 'wfh') },
  { key: 'leave', label: 'On leave', swatch: BAND.leave, show: (s) => s.bands.some((b) => b.kind === 'leave') },
  { key: 'awaited', label: 'Not in yet', swatch: BAND.awaited, show: (s) => s.bands.some((b) => b.kind === 'awaited') },
  { key: 'absent', label: 'Absent', swatch: BAND.absent, show: (s) => s.bands.some((b) => b.kind === 'absent') },
];

/**
 * @param {object[]} rows        jo dikhani hain (card se chhani hui)
 * @param {object[]} allRows     us din ki SAARI rows — paimana isi se banta hai, taaki filter
 *                               badalne par bar apni jagah se na khisken
 * @param {string}   date        us din ki tareekh (YYYY-MM-DD)
 * @param {boolean}  isHoliday   company ki chhutti
 * @param {number}   asOf        data kab aaya (react-query ka dataUpdatedAt) — aaj ke din par
 *                               bar isi waqt tak jaata hai, ghadi tak nahi
 * @param {Function} onPick      row par tap — wahi dialog jo table kholti hai
 */
export function DayTimeline({ rows, allRows, date, isHoliday, asOf, emptyMessage, onPick }) {
  const { data: settings } = useSettings();
  const asOfDate = asOf ? new Date(asOf) : null;
  const isToday = !!asOfDate && date === companyYMD(asOfDate);
  // "24:00" kuch browser aadhi raat ko likhte hain — % se wo 00:00 ban jaata hai.
  const asOfMin = isToday ? (hmToMin(formatTime(asOfDate)) ?? 0) % (24 * 60) : null;

  const { shapes, axis, legend, showAsOf } = React.useMemo(() => {
    const ctx = {
      settings,
      // Tareekh ka weekday — UTC me, warna India se paschim ki device par ek din khisak jaata.
      dow: new Date(`${date}T00:00:00Z`).getUTCDay(),
      isHoliday: !!isHoliday,
      isToday,
      asOfMin,
    };
    const all = (allRows ?? rows).map((r) => shapeRow(r, ctx));
    const wanted = new Set(rows);
    const visible = sortShapes(all.filter((s) => wanted.has(s.row)));
    const ax = axisFor(all, { settings, isToday, asOfMin });
    return {
      shapes: visible,
      axis: ax,
      legend: LEGEND.filter((l) => visible.some(l.show)),
      // "As of" ki lakeer HAR BAAR nahi banti — axis sirf us din ke kaam ke ghante dikhata hai.
      // Raat 8:30 baje (sab 6:30 tak nikal gaye) ya subah 9:30 baje (koi aaya hi nahi) wo
      // paimane se bahar hoti hai. Pehle legend phir bhi "As of 20:30" ka nishaan dikhata tha
      // jo kisi row me tha hi nahi — aur is file ka apna niyam yahi hai ki legend me sirf wahi
      // nishaan aayein jo sach me dikh rahe hain.
      showAsOf: asOfMin != null && asOfMin >= ax.from && asOfMin <= ax.to,
    };
  }, [rows, allRows, date, isHoliday, isToday, asOfMin, settings]);

  if (!shapes.length) {
    return (
      <div className="glass glass-highlight rounded-2xl p-3">
        <p className="py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="glass glass-highlight @container overflow-hidden rounded-2xl">
      {/* Sirf wo nishaan jo is list me sach me hain — legend chhoti rehti hai. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border/60 px-3 py-2.5 text-[11px] text-muted-foreground sm:px-4">
        {legend.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5">
            {l.line ? (
              <span className="h-[3px] w-4 rounded-full bg-warning" />
            ) : (
              <span className={cn('h-3 w-4 rounded-[3px]', l.swatch)} />
            )}
            {!isToday && l.pastLabel ? l.pastLabel : l.label}
          </span>
        ))}
        {showAsOf ? (
          <span className="ml-auto inline-flex items-center gap-1.5 tabular-nums">
            <span className="h-3 w-px bg-primary/70" />
            As of {minToHM(asOfMin)}
          </span>
        ) : null}
      </div>

      <div className="p-2 sm:p-3">
        <div className={cn('grid gap-x-4 px-2 pb-1', ROW_GRID)}>
          <span className="hidden @2xl:block" />
          <Axis axis={axis} />
          <span className="hidden text-right text-[10px] uppercase tracking-wide text-muted-foreground @2xl:block">Worked</span>
        </div>

        <ul>
          {shapes.map((s) => {
            const a = s.row.attendance;
            const times = timesText(s);
            const full = fullText(s);
            const st = effectiveStatus(a, s.row.status);
            const onDuty = st === 'ON_DUTY';
            // "(late)" ka LAFZ server ke status se, amber lakeer ki maujoodgi se nahi: kisi ke
            // ghante baad me badle hon to lakeer shayad na bane, par table tab bhi "(late)"
            // kehti hai — dono ek hi baat bolein.
            const isLate = st === 'LATE';
            const worked = s.came && s.outMin != null ? formatDuration(a?.workedMinutes) : '';
            return (
              <li key={s.row.user.id} className="border-b border-border/40 last:border-0">
                <button
                  type="button"
                  onClick={() => onPick?.(s.row)}
                  title={full}
                  aria-label={full}
                  className={cn(
                    'grid w-full gap-x-4 gap-y-1.5 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-foreground/[0.04]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60',
                    ROW_GRID,
                  )}
                >
                  {/* Phone: naam aur waqt ek kataar me; na samayein to waqt NEECHE utar jaata hai
                      (`flex-wrap`). Pehle naam hi kat-ta tha — "13:55 – 18:05 (late) · Half day"
                      ke saath naam ke liye 40px bachte the. */}
                  <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 @2xl:block">
                    <span className="block min-w-0 truncate text-sm font-medium">{s.row.user.name}</span>
                    <span className="block text-xs tabular-nums text-muted-foreground @2xl:mt-0.5">
                      {times ?? stateText(s)}
                      {isLate && times ? <span className="font-medium text-amber-600 dark:text-amber-300"> (late)</span> : null}
                      {onDuty ? <span> · On duty</span> : null}
                      {/* Sirf aaye hue bande par — jo aaya hi nahi uska lafz pehle se
                          "Half day · no check-in" hai, to ye doosri baar "Half day" chhapta tha. */}
                      {s.half && s.came ? <span> · Half day</span> : null}
                      {/* Selfie wala check-in: us par na deri lagti hai na geo-fence, isliye leadership
                          ko SAAF dikhna zaroori hai (owner ka niyam, 12 Oct 2026). Photo table me. */}
                      {a?.checkInMeta?.selfieKey || a?.checkOutMeta?.selfieKey ? <span> · Selfie</span> : null}
                      {worked ? <span className="@2xl:hidden"> · {worked}</span> : null}
                    </span>
                  </span>
                  <Track s={s} axis={axis} asOfMin={asOfMin} />
                  <span className="hidden text-right text-xs tabular-nums @2xl:block">
                    {worked ? <span className="block">{worked}</span> : null}
                    {a?.overtimeMinutes ? (
                      <span className="block text-emerald-600 dark:text-emerald-300">+{formatDuration(a.overtimeMinutes)}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
