export const COMPANY_TZ = process.env.NEXT_PUBLIC_COMPANY_TZ || 'Asia/Kolkata';

function fmt(date, opts, locale = 'en-GB') {
  return new Intl.DateTimeFormat(locale, { timeZone: COMPANY_TZ, ...opts }).format(new Date(date));
}

/** 12-hour time with AM/PM in company time (e.g. "9:05 PM"), or "—" when missing. */
export function formatTime(date) {
  if (!date) return '—';
  return fmt(date, { hour: 'numeric', minute: '2-digit', hour12: true }, 'en-US');
}

/** 12-hour live clock with seconds in company time (e.g. "9:05:03 PM"). */
export function formatClock(date) {
  return fmt(date, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }, 'en-US');
}

/** "Fri, 20 Jun" style. */
export function formatDayLabel(date) {
  if (!date) return '—';
  return fmt(date, { weekday: 'short', day: '2-digit', month: 'short' });
}

/** "Friday, 20 June 2025" style. */
export function formatFullDate(date) {
  return fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Minutes → "8h 12m". */
export function formatDuration(totalMinutes) {
  const m = Math.max(0, Math.round(totalMinutes || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h}h ${r}m`;
  if (h) return `${h}h`;
  return `${r}m`;
}

/** Local today's date as YYYY-MM-DD (for the overview date picker). */
export function todayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Last `count` months as { key, label, from, to } for the history filter. */
export function recentMonths(count = 6) {
  const out = [];
  const base = new Date();
  for (let i = 0; i < count; i += 1) {
    const date = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const y = date.getFullYear();
    const m = date.getMonth();
    const mm = String(m + 1).padStart(2, '0');
    const lastDay = new Date(y, m + 1, 0).getDate();
    out.push({
      key: `${y}-${mm}`,
      label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      from: `${y}-${mm}-01`,
      to: `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
    });
  }
  return out;
}
