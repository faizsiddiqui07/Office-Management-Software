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

/**
 * Whole rupees → "₹1,234". For amounts that are rupees to begin with and have no
 * paise by construction — a points payout, say. Lives here beside `formatMoney` so
 * every rupee on screen is formatted by this file rather than by a helper each page
 * writes for itself.
 */
export function formatRupees(rupees, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    Number(rupees) || 0,
  );
}

/**
 * A typed amount in rupees → paise (integers, which is how money is stored).
 *
 * This used to be `parseFloat`, which stops at the first character that isn't part of a
 * number and silently returns what it read so far. People type and paste amounts the way
 * they are written on a bill — "12,500.50", "1,00,000", sometimes with the symbol still
 * attached — so a grouping comma truncated the figure: ₹1,00,000 was stored as ₹1.00 and
 * every screen, export, PDF and audit entry downstream repeated it. Neither guard caught
 * it either, because 100 paise is a perfectly valid positive integer.
 *
 * So: strip what is only decoration, then require what remains to be a plain amount.
 * Anything else is a typo and returns 0, which the callers already treat as "no amount"
 * — better to ask again than to guess at half a number.
 */
export function rupeesToPaise(str) {
  const cleaned = String(str ?? '')
    // Grouping separators, ordinary and non-breaking spaces. Indian grouping ("1,00,000")
    // is irregular, so there is nothing to validate here — the digits are the figure.
    .replace(/[\s,\u00A0]/g, '')
    // A currency symbol that came along with a pasted figure.
    .replace(/^(?:\u20B9|rs\.?|inr)/i, '');
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return 0;
  return Math.round(Number(cleaned) * 100);
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

/**
 * Today, as the OFFICE reckons it. Built from the device's clock, this drifted a whole
 * day whenever that clock wasn't on IST — a laptop left on UTC, somebody travelling, a
 * phone that switched zone by itself. At 03:00 IST on 1 September a UTC device still
 * reads 31 August, so an expense dialog opened then defaulted to August, greyed 1
 * September out of the calendar entirely, and filed a September bill under August.
 * Task, visitor and calendar all resolve this in company time already; expenses and dues
 * were the two that didn't.
 */
export function todayYMD() {
  return companyTodayYMD();
}

/**
 * Today in COMPANY time (IST), regardless of the device's own timezone. Reports resolve
 * their period from the date the client sends, so a phone set to a zone behind IST was
 * capping the picker to the wrong day for the first few hours of the Indian day.
 */
export function companyTodayYMD() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
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
  // Anchored on the office's today, not the device's: otherwise "This month" could ask
  // the server for a different month than the dashboard was showing on the same screen.
  const today = companyTodayYMD();
  if (!p?.shift) return today;
  const [y, m] = today.split('-').map(Number);
  // A month-shift preset ("Last month") lands on the 1st of the shifted month.
  // Mutating a full date with setMonth overflowed FORWARD when today's day-of-month
  // was longer than the target month — on 31 Jul, "−1 month" fell back into July, so
  // "Last month" silently showed the CURRENT month. Building from day 1 normalises a
  // negative/overflowing month, and the server only reads the anchor's year+month for a
  // monthly period, so day-1 is exact.
  return new Date(Date.UTC(y, m - 1 + p.shift, 1)).toISOString().slice(0, 10);
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
