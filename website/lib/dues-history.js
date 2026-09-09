/**
 * Month-by-month grouping for a dues ledger — the arithmetic only, no React, so it can
 * be run and checked on its own (scripts/test-dues-history.mjs).
 *
 * Grouped on `dateYMD` — the plain day the entry belongs to — never on the stored
 * instant, which is IST midnight and lands on the previous day for anyone west of
 * India. On the last day of a month that is not a cosmetic slip: the entry would be
 * filed under the wrong month entirely.
 */

export const SORTS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'largest', label: 'Largest amount' },
];

const monthLabel = (key) => {
  if (key === 'undated') return 'No date';
  const d = new Date(`${key}-01T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/**
 * @returns [{ key, label, entries, added, received, dueCount }] — months in the chosen
 * order, and the entries inside each month in that same order.
 *
 * `added` and `received` are what happened THAT month: dues raised, and money taken in.
 * Deliberately NOT a per-month "pending" — a payment settles the OLDEST unpaid dues
 * first, wherever they sit, so money received in September can clear a July lunch. A
 * per-month balance would look authoritative and be arithmetic nobody could reproduce;
 * the one true pending figure is the running one on the balance card.
 */
export function groupByMonth(entries = [], sort = 'newest') {
  const buckets = new Map();
  for (const e of entries) {
    const ymd = typeof e?.dateYMD === 'string' ? e.dateYMD : '';
    // An entry with no usable date still has to appear somewhere. Dropping it would
    // hide real money; its own bucket says plainly that the date is missing.
    const key = /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd.slice(0, 7) : 'undated';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
  }

  const cmp = {
    newest: (a, b) => String(b.dateYMD || '').localeCompare(String(a.dateYMD || '')) || String(b.id).localeCompare(String(a.id)),
    oldest: (a, b) => String(a.dateYMD || '').localeCompare(String(b.dateYMD || '')) || String(a.id).localeCompare(String(b.id)),
    largest: (a, b) => (b.amount || 0) - (a.amount || 0) || String(b.dateYMD || '').localeCompare(String(a.dateYMD || '')),
  }[sort] || undefined;

  const months = [...buckets.entries()].map(([key, list]) => {
    const rows = [...list].sort(cmp);
    return {
      key,
      label: monthLabel(key),
      entries: rows,
      added: rows.filter((e) => e.kind === 'DUE').reduce((s, e) => s + (e.amount || 0), 0),
      received: rows.filter((e) => e.kind !== 'DUE').reduce((s, e) => s + (e.amount || 0), 0),
      dueCount: rows.filter((e) => e.kind === 'DUE').length,
    };
  });

  // Undated always last, whichever way the rest is ordered — it has no place on a
  // timeline and floating it to the top would bury the month people came to read.
  months.sort((a, b) => {
    if (a.key === 'undated') return 1;
    if (b.key === 'undated') return -1;
    return sort === 'oldest' ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key);
  });
  return months;
}
