/**
 * TEAM KE MAHINE KA HISAAB — Everyone tab ke "Month" roop ke liye
 * (components/attendance/team-month.jsx).
 *
 * Sirf ginti, koi JSX aur koi `@/` import nahi — taaki ise akele chala kar asli data par
 * jaancha ja sake, jaise lib/day-timeline.js ke saath kiya gaya.
 *
 * ── DO NIYAM ────────────────────────────────────────────────────────────────
 *
 * 1. HAALAT SERVER SE AATI HAI. Khaane `buildAttendanceDays` se bante hain — wahi helper
 *    jo team-member page chalata hai. Yahan sirf un par ginti hoti hai; kaun late tha ya
 *    kaun absent, ye yahan tay NAHI hota.
 *
 * 2. "KITNE ME SE" KA MATLAB EK HI RAKHA GAYA HAI. Har jagah hisaab un dinon par hai jo
 *    us bande ke liye KAAM KE the (`due`) — chhutti, Sunday, uska weekly off aur janamdin
 *    isme nahi. Isi se "16 of 19" aur neeche ke bar dono bante hain, to wo aapas me kabhi
 *    nahi takrate. Aane wale din aur joining se pehle ke din khaane me `null` hote hain
 *    aur kisi ginti me nahi aate.
 */

/** Deri jo maaf ho chuki hai wo office ka kaam thi — wahi lafz jo baaki app me hai. */
export function cellStatus(cell) {
  if (!cell) return null;
  return cell.s === 'LATE' && cell.ex ? 'ON_DUTY' : cell.s;
}

// Wo din jo is bande ke liye kaam ke the hi nahi.
const OFF = new Set(['WEEKEND', 'HOLIDAY', 'BIRTHDAY']);
// Wo din jab banda kaam par tha (ghar se kaam bhi kaam hai).
const IN = new Set(['PRESENT', 'LATE', 'ON_DUTY', 'WFH']);

/** Khaane par chhan ne ke liye jo nishaan lag sakte hain. */
export const MARKS = {
  late: (c) => c?.s === 'LATE' && !c.ex,
  absent: (c) => c?.s === 'ABSENT',
  leave: (c) => c?.s === 'ON_LEAVE',
  wfh: (c) => c?.s === 'WFH',
  // Aaya to tha, par check-out nahi kiya — isi ki shikayat sabse purani hai.
  open: (c) => !!c?.in && !c.out,
  ot: (c) => (c?.ot || 0) > 0,
};

/** Ek bande ke poore mahine ki ginti. */
export function foldRow(row) {
  const t = { in: 0, due: 0, late: 0, absent: 0, leave: 0, wfh: 0, open: 0, ot: 0, worked: 0 };
  for (const c of row.cells) {
    if (!c) continue; // aane wala din, ya joining se pehle
    const s = cellStatus(c);
    // Chhutti ke din kaam kiya (offDayWork) — wo din "due" me nahi ginte, par kaam ginta hai.
    if (!OFF.has(s)) t.due += 1;
    if (IN.has(s)) t.in += 1;
    if (MARKS.late(c)) t.late += 1;
    if (MARKS.absent(c)) t.absent += 1;
    if (MARKS.leave(c)) t.leave += 1;
    if (MARKS.wfh(c)) t.wfh += 1;
    if (MARKS.open(c)) t.open += 1;
    t.ot += c.ot || 0;
    t.worked += c.w || 0;
  }
  return t;
}

/**
 * Har din ka jod — "us din kitne aaye, kitne aane the".
 *
 * `past` zaroori hai: aane wale din par ginti dikhani hi nahi (owner, 24 Nov 2026). Aam taur
 * par aage ke din ka koi khaana hota hi nahi, par EK haalat me hota hai — jab kisi ki aage ki
 * chhutti pehle se manzoor ho, ya office-wide WFH declare ho chuki ho. Tab us din ka record
 * ban jaata hai aur bina is jaanch ke wahan "0" chhap jaata, jabki us din abhi koi aa hi nahi
 * sakta tha.
 */
export function dayTotals(rows, days, today = '') {
  return days.map((ymd, i) => {
    let came = 0;
    let due = 0;
    let anyone = false;
    for (const r of rows) {
      const c = r.cells[i];
      if (!c) continue;
      anyone = true;
      const s = cellStatus(c);
      if (!OFF.has(s)) due += 1;
      if (IN.has(s)) came += 1;
    }
    return { ymd, came, due, anyone, past: !today || ymd <= today };
  });
}

/** Poore mahine ka ek-line nichod — card ke upar wali line isi se banti hai. */
export function monthHeadline(rows, days, today) {
  const people = rows.map((r) => ({ row: r, t: foldRow(r) }));
  const late = people.filter((p) => p.t.late > 0).sort((a, b) => b.t.late - a.t.late);
  const open = people.filter((p) => p.t.open > 0).sort((a, b) => b.t.open - a.t.open);

  // ── "Sabse khaali din" ──
  // Do cheezein isme se nikalni padti hain, warna wo jhooth bolta hai:
  //
  // 1. AAJ nahi. Din aadha bita hai, to aaj hamesha sabse khaali dikhega.
  //
  // 2. AAM KAAM KA DIN HI. Sunday par sirf weekend wala part-timer "due" hota hai; wo na
  //    aaye to ginti 0 of 1 banti hai — poore mahine ka sabse bura anupaat, jabki office
  //    us din khulta hi nahi. Pehla roop yahi chun raha tha ("Sun 20 Sept — 0 of 1").
  //    Isliye sirf wahi din gine jaate hain jin par kam se kam AADHE log due the.
  const all = dayTotals(rows, days, today).filter((d) => d.anyone && d.due > 0 && d.ymd < today);
  const busiest = Math.max(0, ...all.map((d) => d.due));
  const normal = all.filter((d) => d.due * 2 >= busiest);
  const thin = normal.sort((a, b) => a.came / a.due - b.came / b.due || a.came - b.came)[0] || null;
  return { late, open, thin };
}

/** Khaane ki poori baat ek line me — hover, tap aur screen-reader teeno ke liye. */
export function cellTitle(cell, { status, date, name }) {
  const bits = [name, date, status];
  if (cell?.in) bits.push(cell.out ? 'In–Out' : 'No check-out');
  return bits.filter(Boolean).join(' · ');
}
