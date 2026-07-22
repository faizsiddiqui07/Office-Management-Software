export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'OTHER', label: 'Other' },
];
export const PAYMENT_LABELS = Object.fromEntries(PAYMENT_METHODS.map((p) => [p.value, p.label]));

/** OFFICE_SUPPLIES → "Office supplies" */
export function categoryLabel(cat) {
  if (!cat) return '—';
  return cat
    .split('_')
    .map((w, i) => (i === 0 ? w[0] + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(' ');
}

/** Minor units (paise) → "₹10,000.50" */
export function formatMoney(paise, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(
    (paise || 0) / 100,
  );
}

export function rupeesToPaise(str) {
  const n = parseFloat(str);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function paiseToRupees(paise) {
  return ((paise || 0) / 100).toFixed(2);
}

/**
 * The company FISCAL year (Apr 1 – Mar 31, matching the leave year). `year` is
 * the starting calendar year; `label` reads like "FY 2026–27".
 */
export function currentYearRange() {
  const now = new Date();
  const y = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    from: `${y}-04-01`,
    to: `${y + 1}-03-31`,
    year: y,
    label: `FY ${y}–${String(y + 1).slice(2)}`,
  };
}

export function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabelShort(key) {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short' });
}

export function todayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Period presets. The client only ever sends a NAME and an anchor date — the server
 * turns those into real dates, so the fiscal year here can't drift from the one the
 * reports use, and a phone on the wrong timezone can't shift it either.
 */
export const EXPENSE_PERIODS = [
  { value: 'this_month', label: 'This month', period: 'monthly', shift: 0 },
  { value: 'last_month', label: 'Last month', period: 'monthly', shift: -1 },
  { value: 'this_quarter', label: 'This quarter', period: 'quarterly', shift: 0 },
  { value: 'this_fy', label: 'This year', period: 'yearly', shift: 0 },
  { value: 'custom', label: 'Custom', period: 'custom', shift: 0 },
];

/** The anchor date a preset should be resolved against (months back from today). */
export function anchorFor(preset) {
  const p = EXPENSE_PERIODS.find((x) => x.value === preset);
  const d = new Date();
  if (p?.shift) d.setMonth(d.getMonth() + p.shift);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Minor units (paise) → "₹1.24L" / "₹12,400" — for stat cards, where paise wrap. */
export function formatMoneyShort(paise) {
  const r = Math.round((paise || 0) / 100);
  if (Math.abs(r) >= 10000000) return `₹${(r / 10000000).toFixed(2)}Cr`;
  if (Math.abs(r) >= 100000) return `₹${(r / 100000).toFixed(2)}L`;
  return `₹${new Intl.NumberFormat('en-IN').format(r)}`;
}

/** Axis ticks. Adapts to the range so a ₹3,000 month doesn't read "₹0k" throughout. */
export function formatAxisMoney(paise) {
  const r = Math.round((paise || 0) / 100);
  if (Math.abs(r) >= 100000) return `₹${(r / 100000).toFixed(1)}L`;
  if (Math.abs(r) >= 1000) return `₹${Math.round(r / 1000)}k`;
  return `₹${r}`;
}

const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'];

/**
 * A category always gets the SAME colour. Keying off the array index instead meant
 * the donut reshuffled its colours every time a filter changed the ordering.
 */
export function categoryColor(key = '') {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return CHART_COLORS[h % CHART_COLORS.length];
}

/** "up 18%" / "down 4%" / null when there's nothing meaningful to compare against. */
export function deltaVs(current, previous) {
  if (previous == null || previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (!Number.isFinite(pct) || pct === 0) return { pct: 0, dir: 'flat' };
  return { pct: Math.abs(pct), dir: pct > 0 ? 'up' : 'down' };
}
