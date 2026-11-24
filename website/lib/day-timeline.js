/**
 * DIN KI TIMELINE KA HISAAB — Everyone tab ka "Timeline" roop isi par chalta hai
 * (components/attendance/day-timeline.jsx).
 *
 * Sirf hisaab, koi JSX nahi aur koi `@/` import nahi — taaki ise akele chala kar asli data
 * par jaancha ja sake. Har waqt yahan "company ki aadhi raat se kitne MINUTE" me hai.
 *
 * ── TEEN NIYAM JINSE TASVEER TABLE SE KABHI ALAG NAHI BOLTI ──────────────────
 *
 * 1. LATE KA FAISLA YAHAN NAHI HOTA. Server likh kar bhejta hai (status LATE); yahan bas
 *    "kab aana tha" aur "kab aaye" ke beech ki lambai dikhayi jaati hai. Khud se tolte to
 *    grace, selfie ki chhoot, maaf ki hui deri aur purane niyam (13 Sep se pehle) — sab
 *    dobara likhne padte, aur ek din dono alag ho jaate.
 *
 * 2. OVERTIME BHI SERVER KA. `overtimeMinutes` jitna hai utna hi bar ke AAKHIR me gehra
 *    hota hai. Wo kabhi-kabhi poore bar se bhi lamba ho sakta hai (raat ko aane wale ka OT
 *    shift ke ant se ginta hai, uske aane se nahi), isliye bar par rok diya jaata hai.
 *
 * 3. JO PATA NAHI WO KHINCHA NAHI JAATA. Har aathve check-in par check-out hai hi nahi.
 *    Aise purane din par bar ka ant BANAYA nahi jaata — sirf aane ka nishaan dikhta hai.
 *    Aur aaj ke din par bar GHADI tak nahi, DATA AANE KE WAQT tak jaata hai (`asOfMin`):
 *    roster apne aap taaza nahi hota (queryClient: refetchOnWindowFocus false, koi interval
 *    nahi), to ghadi par chalte to 10:45 par khola hua page shaam 7:30 par un logon ko bhi
 *    andar dikhata jo ghante bhar pehle ja chuke hain.
 */

const DAY_MIN = 24 * 60;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 'HH:mm' → minute. Khaali ya galat ho to null. */
export function hmToMin(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** minute → 'HH:mm' (24:00 ko 24:00 hi rehne do — axis ka aakhri ank). */
export function minToHM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
}

/**
 * Is bande ki shift: apne ghante hon to wo, warna office ke.
 *
 * Yahi do line backend ke `effectiveSchedule` (backend/src/lib/schedule.js) me hain. Yahan
 * ye SIRF peechhe ki halki patti banane ke liye hai — is par koi faisla nahi tikta, to ye
 * kabhi alag ho bhi jaaye to sirf ek patti apni jagah se khiskegi, kisi ka record nahi.
 *
 * AAJ ki shift hi pata hoti hai: kisi ne October me apne ghante badle the to September ke
 * din par bhi naye ghante hi dikhenge. Isliye deri ki lambai bhi tabhi banti hai jab aana
 * sach me shift ke baad ka ho (dekho `late`).
 */
export function shiftOf(user, settings) {
  const s = user?.schedule ?? {};
  const start = hmToMin(s.workStart || settings?.workStart);
  const end = hmToMin(s.workEnd || settings?.workEnd);
  if (start == null || end == null || end <= start) return null;
  return { start, end, mid: Math.floor((start + end) / 2) };
}

/** Kya ye din is bande ke liye chhutti ka tha? (company holiday / uska weekly off / janamdin) */
function isOffFor(row, { dow, isHoliday, settings }) {
  if (row.status === 'HOLIDAY' || row.status === 'BIRTHDAY') return true;
  if (row.attendance?.offDayWork || isHoliday) return true;
  const wd = row.user?.schedule?.workDays;
  if (Array.isArray(wd) && wd.length) return !wd.includes(dow);
  return (settings?.weekendDays ?? []).includes(dow);
}

// Kram: jo aaye wo pehle (aane ke waqt se), phir baaki apni-apni haalat me.
const GROUP = { IN: 0, WFH: 1, AWAITED: 2, ABSENT: 3, ON_LEAVE: 4, OFF: 5 };

/**
 * Ek row → timeline par kya-kya banega.
 *
 * @param {object} row  overview ki ek row: { user, attendance, status }
 * @param {object} ctx  { settings, dow, isHoliday, isToday, asOfMin }
 *                      asOfMin = DATA kab aaya tha (ghadi ka "abhi" nahi — niyam 3)
 */
export function shapeRow(row, ctx) {
  const a = row.attendance;
  const shift = shiftOf(row.user, ctx.settings);
  const off = isOffFor(row, ctx);

  // `attendance.date` us din ki company-aadhi-raat ka instant hai, to isse ghatana hi
  // sabse seedha raasta hai — beech me koi timezone nahi aata.
  const base = a?.date ? new Date(a.date).getTime() : NaN;
  const at = (iso) => {
    if (!iso || Number.isNaN(base)) return null;
    const m = (new Date(iso).getTime() - base) / 60000;
    return Number.isFinite(m) ? clamp(m, 0, DAY_MIN) : null;
  };

  const inMin = at(a?.checkInAt);
  const rawOut = at(a?.checkOutAt);
  // Jaana aane se pehle ho (haath se bhari galat entry) — us ant par bar nahi banta, par
  // check-out HUA hai, to use "abhi andar" ya "check-out nahi kiya" bhi nahi kehte.
  const badOut = rawOut != null && inMin != null && rawOut < inMin;
  const outMin = badOut ? null : rawOut;
  const came = inMin != null;
  const open = came && rawOut == null;
  const running = open && !!ctx.isToday; // check-out abhi nahi hua

  const bar = came
    ? { from: inMin, to: outMin ?? (running ? clamp(Math.max(ctx.asOfMin ?? inMin, inMin), 0, DAY_MIN) : null) }
    : null;

  const otMin = Math.max(0, Number(a?.overtimeMinutes) || 0);
  const ot = came && outMin != null && otMin > 0 && outMin > inMin
    ? { from: Math.max(inMin, outMin - otMin), to: outMin }
    : null;

  // Aadha din: pehla aadha chhutti (FIRST) to aana aadhe se tha, doosra (SECOND) to shuru se.
  const half = a?.halfDayLeave && shift ? (a.halfDayPart === 'SECOND' ? 'SECOND' : 'FIRST') : null;
  const dueFrom = shift ? (half === 'FIRST' ? shift.mid : shift.start) : null;

  const late = a?.status === 'LATE' && !a?.excused && came && dueFrom != null && inMin > dueFrom
    ? { from: dueFrom, to: inMin }
    : null;

  // Peechhe ki patti(yan). `due` = is waqt aana tha (halki grey); baaki status ki apni.
  const bands = [];
  let group = GROUP.OFF;
  if (came) group = GROUP.IN;
  if (shift) {
    if (row.status === 'WFH') { bands.push({ kind: 'wfh', from: shift.start, to: shift.end }); }
    else if (row.status === 'ON_LEAVE' && !half) { bands.push({ kind: 'leave', from: shift.start, to: shift.end }); }
    else if (row.status === 'ABSENT' && !came) { bands.push({ kind: 'absent', from: shift.start, to: shift.end }); }
    else if (row.status === 'AWAITED') { bands.push({ kind: 'awaited', from: shift.start, to: shift.end }); }
    else if (half) {
      bands.push(half === 'FIRST'
        ? { kind: 'leave', from: shift.start, to: shift.mid }
        : { kind: 'leave', from: shift.mid, to: shift.end });
      bands.push(half === 'FIRST'
        ? { kind: 'due', from: shift.mid, to: shift.end }
        : { kind: 'due', from: shift.start, to: shift.mid });
    } else if (!off && came) { bands.push({ kind: 'due', from: shift.start, to: shift.end }); }
  }
  if (!came) {
    if (row.status === 'WFH') group = GROUP.WFH;
    else if (row.status === 'AWAITED') group = GROUP.AWAITED;
    else if (row.status === 'ABSENT') group = GROUP.ABSENT;
    else if (row.status === 'ON_LEAVE') group = GROUP.ON_LEAVE;
  }

  return {
    row, group, shift, off, half, bands,
    inMin, outMin, badOut, came, open, running, bar, ot, late, dueFrom,
    isToday: !!ctx.isToday,
  };
}

/**
 * Poore din ka paimana — jitna us din ke liye chahiye, ghante par gol kiya hua.
 *
 * JO SACH ME AAYA, WO POORA ANDAR AATA HAI — hamesha. Uske baad jo NAHI aaye (chhutti,
 * gair-hazir, abhi tak nahi aaye) unki shift ki patti bhi andar aati hai, taaki unka khaali
 * khaana kahin to baithe.
 *
 * PAR JO NAHI AAYA USKI SHIFT OFFICE KE GHANTON SE BAHAR NAHI KHEENCH SAKTI. Pehle yahan
 * likha tha ki "chhutti wale ki shift nahi ginti" — wo GALAT tha: sirf Sunday aur holiday ki
 * row koi patti banati hi nahi thi, isliye bachaav ittefaq se ho raha tha. Jis din 14:00–22:00
 * wala banda CHHUTTI par ho, uski patti paimane ko 22:00 tak le jaati thi aur us din office me
 * aaye har bande ka bar ek-tihai patla ho jaata — ek aise aadmi ki wajah se jo tha hi nahi.
 *
 * Agar us din KOI bhi nahi aaya, to pattiyan hi ek-matra khabar hain — tab wo poori ginti
 * hain (warna sirf part-timer wale Sunday par paimana bemaani ho jaata).
 */
export function axisFor(shapes, { settings, isToday, asOfMin } = {}) {
  let lo = Infinity;
  let hi = -Infinity;
  const take = (v) => {
    if (v == null || !Number.isFinite(v)) return;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  };
  const coStart = hmToMin(settings?.workStart);
  const coEnd = hmToMin(settings?.workEnd);
  const anyCame = shapes.some((s) => s.bar);
  // Office ke ghante pata hon AUR koi aaya ho, tabhi na-aaye hue logon ki patti kasi jaati hai.
  const capped = anyCame && coStart != null && coEnd != null && coEnd > coStart;
  for (const s of shapes) {
    take(s.inMin);
    take(s.outMin);
    if (s.bar) { take(s.bar.from); take(s.bar.to); }
    const fit = capped && !s.bar ? (v) => clamp(v, coStart, coEnd) : (v) => v;
    for (const b of s.bands) { take(fit(b.from)); take(fit(b.to)); }
  }
  // Kisi ka kuch bhi na ho (Sunday, ya naya din) — office ke ghante.
  if (lo === Infinity) {
    take(hmToMin(settings?.workStart) ?? 9 * 60);
    take(hmToMin(settings?.workEnd) ?? 18 * 60);
  }
  // Din chal raha ho to "As of" ki lakeer bhi andar rahe — par sirf din ke waqt; raat 11 baje
  // khaali office ke liye paimana khinchna bemaani hai.
  if (isToday && asOfMin != null && asOfMin >= lo && asOfMin <= hi + 60) take(asOfMin);

  let from = Math.floor(lo / 60) * 60;
  let to = Math.ceil(hi / 60) * 60;
  const MIN_SPAN = 6 * 60;
  if (to - from < MIN_SPAN) to = Math.min(DAY_MIN, from + MIN_SPAN);
  if (to - from < MIN_SPAN) from = Math.max(0, to - MIN_SPAN);
  from = clamp(from, 0, DAY_MIN);
  to = clamp(to, from + 60, DAY_MIN);

  const span = to - from;
  // Lakeer har ghante, ank har doosre; din lamba ho to har teesre/chauthe, taaki patli patti
  // par bhi ank ek doosre par na chadhen (har lambai aur chaudai par naapa gaya).
  const labelEvery = span > 20 * 60 ? 240 : span > 14 * 60 ? 180 : 120;
  const ticks = [];
  for (let m = from; m <= to; m += 60) ticks.push({ min: m, label: m % labelEvery === 0 ? minToHM(m) : null });
  return { from, to, span, ticks };
}

/** Axis par jagah, % me. */
export function pct(min, axis) {
  return ((clamp(min, axis.from, axis.to) - axis.from) / axis.span) * 100;
}

/** Aaye hue pehle (jaldi aane wala sabse upar), phir baaki apni haalat me, naam se. */
export function sortShapes(shapes) {
  return [...shapes].sort((x, y) => {
    if (x.group !== y.group) return x.group - y.group;
    if (x.inMin != null && y.inMin != null && x.inMin !== y.inMin) return x.inMin - y.inMin;
    return (x.row.user?.name || '').localeCompare(y.row.user?.name || '');
  });
}
