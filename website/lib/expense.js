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

export function currentYearRange() {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31`, year: y };
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
