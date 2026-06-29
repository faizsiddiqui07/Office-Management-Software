export const LEAVE_TYPES = [
  { value: 'CASUAL', label: 'Casual' },
  { value: 'SICK', label: 'Sick' },
  { value: 'PAID', label: 'Paid' },
  { value: 'UNPAID', label: 'Unpaid (LOP)' },
];

export const LEAVE_TYPE_LABELS = Object.fromEntries(LEAVE_TYPES.map((t) => [t.value, t.label]));

const PAID_TYPES = ['CASUAL', 'SICK', 'PAID'];
export const isPaidType = (t) => PAID_TYPES.includes(t);

/** Mirrors the server's working-days math (default weekend = Sunday; excludes holidays). */
export function computeWorkingDaysClient(startYMD, endYMD, halfDay, weekend = [0], holidays = new Set()) {
  if (!startYMD || !endYMD || endYMD < startYMD) return 0;
  const days = [];
  let d = new Date(`${startYMD}T00:00:00Z`);
  const end = new Date(`${endYMD}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    days.push(d);
    d = new Date(d.getTime() + 86400000);
  }
  const working = days.filter(
    (x) => !weekend.includes(x.getUTCDay()) && !holidays.has(x.toISOString().slice(0, 10)),
  );
  if (halfDay && days.length === 1 && working.length === 1) return 0.5;
  return working.length;
}

export function formatYMD(ymd) {
  if (!ymd) return '—';
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatRange(startYMD, endYMD) {
  if (!startYMD) return '—';
  if (startYMD === endYMD) return formatYMD(startYMD);
  return `${formatYMD(startYMD)} – ${formatYMD(endYMD)}`;
}
