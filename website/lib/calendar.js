export const EVENT_TYPES = {
  HOLIDAY: { label: 'Holiday', tone: 'destructive', dot: 'bg-destructive', chip: 'bg-destructive/12 text-destructive' },
  OPTIONAL_HOLIDAY: { label: 'Optional', tone: 'warning', dot: 'bg-warning', chip: 'bg-warning/15 text-amber-600 dark:text-amber-300' },
  EVENT: { label: 'Event', tone: 'info', dot: 'bg-info', chip: 'bg-info/12 text-info' },
  BIRTHDAY: { label: 'Birthday', tone: 'primary', dot: 'bg-fuchsia-500', chip: 'bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-300' },
};

export const EVENT_TYPE_OPTIONS = [
  { value: 'HOLIDAY', label: 'Holiday' },
  { value: 'OPTIONAL_HOLIDAY', label: 'Optional holiday' },
  { value: 'EVENT', label: 'Event' },
  { value: 'BIRTHDAY', label: 'Birthday 🎂' },
];

export function ymdOf(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function todayYMDLocal() {
  // Company-timezone "today" (en-CA gives YYYY-MM-DD) so devices abroad don't shift the day.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/** 6-week grid of cells { date, ymd, inMonth } for a month. */
export function buildMonthGrid(year, month) {
  const startDow = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i += 1) cells.push({ date: new Date(year, month, 1 - startDow + i), inMonth: false });
  for (let d = 1; d <= daysInMonth; d += 1) cells.push({ date: new Date(year, month, d), inMonth: true });
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false });
  }
  return cells.map((c) => ({ ...c, ymd: ymdOf(c.date.getFullYear(), c.date.getMonth(), c.date.getDate()) }));
}

export function expandEventDates(ev) {
  const out = [];
  let d = new Date(`${ev.startYMD}T00:00:00Z`);
  const end = new Date(`${ev.endYMD}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

/**
 * YMD set of mandatory HOLIDAY dates within [fromYMD, toYMD] (for the apply preview).
 *
 * Follows the server's own `countsForWorkingDays` rather than deciding for itself. A
 * yearly repeat is shown on the calendar in every year but only counts as a non-working
 * day from the date the repeat was switched on — if this guessed instead, the dialog
 * would promise "3 days" and the server would deduct 4.
 */
export function holidayYMDSetFromList(holidays, fromYMD, toYMD) {
  const set = new Set();
  for (const h of holidays || []) {
    if (h.type !== 'HOLIDAY') continue;
    if (h.countsForWorkingDays === false) continue;
    for (const d of expandEventDates(h)) if (d >= fromYMD && d <= toYMD) set.add(d);
  }
  return set;
}
