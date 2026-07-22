import { getAuthToken } from '@/lib/api';
import { COMPANY_TZ } from '@/lib/time';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const PDF_SCOPES = [
  { value: 'all', label: 'All Work' },
  { value: 'pending', label: 'Pending only' },
  { value: 'completed', label: 'Completed only' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'year', label: 'Last year' },
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

export async function downloadTasksPdf(scope, view = 'mine') {
  const url = `${API_BASE}/api/tasks/export.pdf?scope=${encodeURIComponent(scope)}&view=${view}`;
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
