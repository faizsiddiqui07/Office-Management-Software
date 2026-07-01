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
