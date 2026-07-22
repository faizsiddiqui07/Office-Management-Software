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

/**
 * Axis ticks. Adapts to the range so a ₹3,000 month doesn't read "₹0k" on every tick,
 * and keeps a decimal below ₹10k — rounding ticks of 1512/3025/4537 to whole thousands
 * printed "₹2k ₹3k ₹5k", which looks like uneven spacing on an evenly spaced axis.
 */
export function formatAxisMoney(paise) {
  const r = Math.round((paise || 0) / 100);
  const a = Math.abs(r);
  if (a >= 100000) return `₹${(r / 100000).toFixed(1)}L`;
  if (a >= 10000) return `₹${Math.round(r / 1000)}k`;
  if (a >= 1000) return `₹${(r / 1000).toFixed(1)}k`;
  return `₹${r}`;
}

// Ordered so that neighbours are far apart in hue — categories are handed these in
// sequence, so the two or three biggest slices are always clearly different colours.
const CHART_COLORS = [
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#06b6d4', // cyan
  '#a855f7', // purple
  '#84cc16', // lime
  '#ec4899', // pink
  '#0ea5e9', // sky
  '#f97316', // orange
];

function hashIndex(key = '') {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % CHART_COLORS.length;
}

/**
 * A category's colour, stable across every filter and re-order.
 *
 * Position in the office's configured category list decides it — that list is fixed
 * in Settings, so the colour never moves, and consecutive categories get hues that
 * are easy to tell apart. Hashing the name instead gave stability but not
 * distinctness: "Utilities" and "Travel" both landed on amber and the donut read as
 * one colour. The hash survives only as a fallback for a category no longer in the
 * list, where any stable colour will do.
 */
export function categoryColor(key = '', categories) {
  const i = Array.isArray(categories) ? categories.indexOf(key) : -1;
  return CHART_COLORS[(i >= 0 ? i : hashIndex(key)) % CHART_COLORS.length];
}

/** "up 18%" / "down 4%" / null when there's nothing meaningful to compare against. */
export function deltaVs(current, previous) {
  if (previous == null || previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (!Number.isFinite(pct) || pct === 0) return { pct: 0, dir: 'flat' };
  return { pct: Math.abs(pct), dir: pct > 0 ? 'up' : 'down' };
}
