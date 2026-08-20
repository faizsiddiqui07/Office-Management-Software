import { downloadFile } from '@/lib/api';
import { COMPANY_TZ } from '@/lib/time';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Current time as "HH:mm" in company time — the default check-in time. */
export function nowHM() {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: COMPANY_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  } catch {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

/** Today (YYYY-MM-DD) in company time. */
export function todayYMD() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TZ }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Download the visitor register as CSV or PDF, respecting the given filters. */
export async function downloadVisitors(format, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  const url = `${API_BASE}/api/visitors/export.${format}${qs ? `?${qs}` : ''}`;
  // One iOS-safe download path for the whole app — see downloadFile.
  await downloadFile(url, `visitors.${format}`);
}

/** Download a single visitor's printable pass PDF. */
export async function downloadVisitorPass(id, name = '') {
  const safe = (name || 'visitor').replace(/\s+/g, '-').toLowerCase();
  await downloadFile(`${API_BASE}/api/visitors/${id}/pass.pdf`, `visitor-pass-${safe}.pdf`);
}
