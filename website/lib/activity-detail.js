/**
 * Activity-log rows, turned into something a person can read.
 *
 * No React in here on purpose: the money bug this exists to prevent (paise printed as
 * rupees) is pure arithmetic, and arithmetic that handles money should be runnable and
 * checkable on its own — scripts/test-activity-detail.mjs.
 */
import { formatMoney } from './expense.js';

export function humanize(a) {
  return a.replace(/\./g, ' · ').replace(/_/g, ' ');
}

// Anything whose NAME suggests a credential is never printed, whatever it holds. The
// log is read by leadership and some entries carry a whole request body.
const SECRET_KEY = /pass|token|secret|hash|key|otp/i;

// Money is held in PAISE everywhere in this app — LedgerEntry.amount and Expense.amount
// are both "a whole number of paise" — so a ₹40 lunch reaches the log as 4000. Printed
// raw that reads as ₹4,000: the right number, out by a factor of a hundred, on the one
// page people open to check what was spent. Only these actions carry money; a number in
// any other meta is a count or a score and must be left exactly as it is.
const MONEY_ACTION = /^(dues|expense)\./;

// A bare 24-character id tells a human nothing and crowds out what does.
const OBJECT_ID = /^[a-f\d]{24}$/i;

/**
 * One short line saying what the entry was actually about.
 *
 * "task · update" on its own answers nothing — the question people bring here is which
 * task, and what changed about it. The known shapes are spelled out; anything else falls
 * back to its first couple of simple values, so a new action added later still says
 * something rather than showing a blank.
 */
export function detailOf(l) {
  const m = l.meta || {};
  const bits = [];
  if (m.title) bits.push(m.title);
  if (m.person && !OBJECT_ID.test(String(m.person))) bits.push(String(m.person));
  if (typeof m.amount === 'number') {
    bits.push(MONEY_ACTION.test(l.action || '') ? formatMoney(m.amount) : String(m.amount));
  }
  if (m.category) bits.push(String(m.category));
  if (Array.isArray(m.fields) && m.fields.length) bits.push(`changed ${m.fields.join(', ')}`);
  if (m.status) bits.push(String(m.status).toLowerCase().replace(/_/g, ' '));
  if (m.owner) bits.push(`for ${m.owner}`);
  if (m.cascaded) bits.push(`${m.cascaded} forwarded ${m.cascaded === 1 ? 'copy' : 'copies'} too`);
  if (m.reason) bits.push(`“${m.reason}”`);
  if (typeof m.to === 'string' && m.to) bits.push(`to ${m.to}`);
  if (m.email) bits.push(m.email);
  if (!bits.length) {
    for (const [k, v] of Object.entries(m)) {
      if (bits.length >= 2) break;
      if (v == null || typeof v === 'object' || SECRET_KEY.test(k)) continue;
      if (OBJECT_ID.test(String(v))) continue; // a raw id, not something to read
      bits.push(`${k}: ${typeof v === 'boolean' ? (v ? 'yes' : 'no') : v}`);
    }
  }
  return bits.join(' · ');
}
