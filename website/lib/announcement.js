import { COMPANY_TZ } from './time';

export const PRIORITY = {
  NORMAL: { label: 'Normal', tone: 'info' },
  IMPORTANT: { label: 'Important', tone: 'warning' },
  URGENT: { label: 'Urgent', tone: 'destructive' },
};

export const PRIORITY_OPTIONS = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'IMPORTANT', label: 'Important' },
  { value: 'URGENT', label: 'Urgent' },
];

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: COMPANY_TZ,
    day: '2-digit',
    month: 'short',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: COMPANY_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${date}, ${time}`;
}

// ── Repeats ────────────────────────────────────────────────────────────────────
// Mirrors backend/src/lib/recurrence.js for DISPLAY only. The server decides when a
// post actually goes out; this just says the rule back in words.
export const RECURRENCE_OPTIONS = [
  { value: 'NONE', label: 'Doesn’t repeat' },
  { value: 'WEEKLY', label: 'Every week' },
  { value: 'MONTHLY', label: 'Every month' },
  { value: 'YEARLY', label: 'Every year' },
];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/** "Every Saturday at 09:00" — empty for a post that doesn't repeat. */
export function describeRecurrence(r) {
  if (!r || !r.type || r.type === 'NONE') return '';
  const at = r.time ? ` at ${r.time}` : '';
  if (r.type === 'WEEKLY' && r.weekday != null) return `Every ${WEEKDAYS_LONG[r.weekday]}${at}`;
  if (r.type === 'MONTHLY' && r.dayOfMonth != null) return `Every month on the ${ordinal(r.dayOfMonth)}${at}`;
  if (r.type === 'YEARLY' && r.month != null && r.dayOfMonth != null) return `Every year on ${r.dayOfMonth} ${MONTHS[r.month - 1]}${at}`;
  return '';
}
