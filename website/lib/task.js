import { downloadFile } from '@/lib/api';
import { COMPANY_TZ } from '@/lib/time';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Only WHAT to include. The day ranges that used to live here ("Last 7 days" and friends)
// duplicated the list's own date filter word for word, sitting beside it as a second
// identical-looking dropdown that changed the download and not the screen. The PDF now
// inherits whatever range the list is showing, so there is one place to pick a range.
export const PDF_SCOPES = [
  { value: 'all', label: 'All work' },
  { value: 'pending', label: 'Pending only' },
  { value: 'completed', label: 'Completed only' },
];

export function todayYMD() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TZ }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Is a YYYY-MM-DD due date in the past (before today, company time)? */
export function isOverdue(dueYMD) {
  return !!dueYMD && dueYMD < todayYMD();
}

/** 'YYYY-MM-DD' + n days, still as 'YYYY-MM-DD'. */
export function addDaysYMD(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The LAST day work still counts as on time: the due date plus the office's grace days
 * (Settings — Bonus). Scoring compares the completion day against exactly this, so the
 * UI can promise the same thing the points system will actually do. No due date means
 * nothing to be late for.
 */
export function onTimeUntil(dueYMD, graceDays = 0) {
  if (!dueYMD) return null;
  return graceDays > 0 ? addDaysYMD(dueYMD, graceDays) : dueYMD;
}

/**
 * @param {string} scope  what to include: all | pending | completed | week | month | year
 * @param {'mine'|'tagged'|'assigned'} view  WHICH list — my own work, work I'm only
 *   tagged on, or work I handed out. Each prints separately: a tagged task is somebody
 *   else's and never belongs in the other two's figures.
 */
export async function downloadTasksPdf(scope, view = 'mine', filters = {}) {
  const p = new URLSearchParams({ scope, view });
  // Carry the on-screen date range and search into the export.
  if (filters.from) p.set('from', filters.from);
  if (filters.to) p.set('to', filters.to);
  if (!filters.from && !filters.to && filters.period && filters.period !== 'all' && filters.period !== 'custom') {
    p.set('period', filters.period);
  }
  if (filters.dateBasis) p.set('dateBasis', filters.dateBasis);
  if (filters.search) p.set('search', filters.search);
  const url = `${API_BASE}/api/tasks/export.pdf?${p.toString()}`;
  // One iOS-safe download path for the whole app — see downloadFile. The view is in the
  // filename so a tagged export doesn't overwrite the one for your own tasks.
  await downloadFile(url, `tasks-${view === 'mine' ? '' : `${view}-`}${scope}.pdf`);
}
