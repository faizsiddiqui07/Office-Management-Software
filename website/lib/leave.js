// The leave dialog's type dropdown offers only Casual and Sick — both draw from the paid
// quota. "Paid" was a redundant third quota type and "Unpaid (LOP)" (leave beyond quota)
// is no longer offered; both are retired as choices. They live on only in
// LEAVE_TYPE_LABELS so any historical request that still carries them keeps reading right.
export const LEAVE_TYPES = [
  { value: 'CASUAL', label: 'Casual' },
  { value: 'SICK', label: 'Sick' },
];

// Display labels — kept for the retired types too, so an old Paid/Unpaid request still
// reads properly in lists, reports and history even though it can't be picked any more.
export const LEAVE_TYPE_LABELS = {
  CASUAL: 'Casual',
  SICK: 'Sick',
  PAID: 'Paid',
  UNPAID: 'Unpaid (LOP)',
};

/**
 * Work from home. Deliberately NOT in LEAVE_TYPES — that array fills the leave dialog's
 * type dropdown, and WFH must never be pickable as a kind of leave: it deducts nothing,
 * it is a worked day, and it has its own one-day / yearly-allowance rules.
 */
export const WFH_TYPE = 'WFH';
export const isWFHType = (t) => t === WFH_TYPE;
/** Every request type that can appear in a list, for display only. */
export const REQUEST_TYPE_LABELS = { ...LEAVE_TYPE_LABELS, [WFH_TYPE]: 'Work from home' };
export const requestTypeLabel = (t) => REQUEST_TYPE_LABELS[t] ?? t;

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
