import { getAuthToken } from '@/lib/api';
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

export async function downloadTasksPdf(scope, view = 'mine', filters = {}) {
  const p = new URLSearchParams({ scope, view });
  // Carry the on-screen date range and search into the export.
  if (filters.from) p.set('from', filters.from);
  if (filters.to) p.set('to', filters.to);
  if (!filters.from && !filters.to && filters.period && filters.period !== 'all' && filters.period !== 'custom') {
    p.set('period', filters.period);
  }
  if (filters.search) p.set('search', filters.search);
  const url = `${API_BASE}/api/tasks/export.pdf?${p.toString()}`;
  const res = await fetch(url, { cache: 'no-store', headers: { Authorization: `Bearer ${getAuthToken()}` } });
  if (!res.ok) throw new Error('Could not generate the PDF');
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = `tasks-${scope}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}
