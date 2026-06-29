import mongoose from 'mongoose';
import { LedgerEntry } from '../models/LedgerEntry.js';
import { User } from '../models/User.js';
import { notify } from '../models/Notification.js';
import { companyDayFromYMD } from '../lib/time.js';

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

const money = (paise) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function assertId(id) {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'BAD_ID', 'Invalid id');
}

function stateLabel({ pending, advance }) {
  if (pending > 0) return `Pending ${money(pending)}`;
  if (advance > 0) return `Advance ${money(advance)}`;
  return 'All settled';
}

/**
 * Core ledger reducer. Each DUE carries its own `paid` (cash settled directly
 * against that item). PAYMENT entries are generic credit (advance / extra cash)
 * that covers the oldest still-unpaid dues first; whatever's left over is the
 * person's advance balance.
 * @param {Array<{_id:any, kind:string, amount:number, paid?:number, date:any, createdAt:any}>} rawEntries
 * @returns {{ pending:number, advance:number, remainingById:Map<string,number> }}
 */
function computeLedger(rawEntries) {
  const ts = (e, field) => new Date(e[field] ?? 0).getTime();
  const sorted = [...rawEntries].sort((a, b) => ts(a, 'date') - ts(b, 'date') || ts(a, 'createdAt') - ts(b, 'createdAt'));

  const dues = sorted
    .filter((e) => e.kind === 'DUE')
    .map((d) => ({ id: String(d._id), remaining: Math.max(0, d.amount - (d.paid || 0)) }));
  let pool = sorted.filter((e) => e.kind === 'PAYMENT').reduce((s, c) => s + c.amount, 0);

  for (const d of dues) {
    const applied = Math.min(d.remaining, pool);
    d.remaining -= applied;
    pool -= applied;
  }

  return {
    pending: dues.reduce((s, d) => s + d.remaining, 0),
    advance: pool,
    remainingById: new Map(dues.map((d) => [d.id, d.remaining])),
  };
}

async function stateFor(personId) {
  const docs = await LedgerEntry.find({ person: personId }).select('kind amount paid date createdAt');
  return computeLedger(docs);
}

/** One person's full ledger: per-due status + derived pending/advance. */
export async function ledgerFor(personId) {
  const docs = await LedgerEntry.find({ person: personId }).sort({ date: -1, createdAt: -1 }).limit(300).populate('createdBy', 'name');
  const { pending, advance, remainingById } = computeLedger(docs);
  const entries = docs.map((d) => {
    const j = d.toJSON();
    if (j.kind === 'DUE') {
      const remaining = remainingById.get(String(d._id)) ?? Math.max(0, j.amount - (j.paid || 0));
      j.remaining = remaining;
      j.status = remaining === 0 ? 'PAID' : remaining < j.amount ? 'PARTIAL' : 'PENDING';
    }
    return j;
  });
  return { pending, advance, entries };
}

export async function personLedger(personId) {
  assertId(personId);
  const person = await User.findById(personId).select('name employeeId role department');
  if (!person) throw httpError(404, 'NOT_FOUND', 'User not found');
  return { person: person.toJSON(), ...(await ledgerFor(personId)) };
}

/** Admin-manager roster: every active user with their balance + company totals. */
export async function overview() {
  const docs = await LedgerEntry.find().select('person kind amount paid date createdAt');
  const byPerson = new Map();
  for (const d of docs) {
    const pid = String(d.person);
    if (!byPerson.has(pid)) byPerson.set(pid, []);
    byPerson.get(pid).push(d);
  }

  const users = await User.find({ isActive: true }).select('name employeeId role department').sort({ name: 1 });
  const people = users.map((u) => {
    const list = byPerson.get(String(u._id)) || [];
    const { pending, advance } = computeLedger(list);
    const last = list.reduce((mx, e) => (!mx || e.date > mx ? e.date : mx), null);
    return { person: u.toJSON(), pending, advance, lastActivity: last };
  });

  return {
    people,
    totalPending: people.reduce((s, p) => s + p.pending, 0),
    totalAdvance: people.reduce((s, p) => s + p.advance, 0),
    owingCount: people.filter((p) => p.pending > 0).length,
  };
}

export async function createDue(admin, { person, amount, item, source, dateYMD, note }) {
  const target = await User.findById(person).select('_id');
  if (!target) throw httpError(404, 'NOT_FOUND', 'User not found');

  const entry = await LedgerEntry.create({
    person,
    createdBy: admin._id,
    kind: 'DUE',
    amount,
    paid: 0,
    item: item || '',
    source: source || '',
    dateYMD,
    date: companyDayFromYMD(dateYMD),
    note: note || '',
  });

  const state = await stateFor(person);
  const what = [item || 'Item', source ? `from ${source}` : ''].filter(Boolean).join(' ');
  await notify({
    user: person,
    type: 'DUE_ADDED',
    title: `${money(amount)} added by ${admin.name}`,
    message: `${what} • ${stateLabel(state)}`,
    link: '/dues',
  });

  return { entry: entry.toJSON(), pending: state.pending, advance: state.advance };
}

/** Generic money received — advance / extra cash (covers oldest dues, rest = advance). */
export async function createPayment(admin, { person, amount, dateYMD, note }) {
  const target = await User.findById(person).select('_id');
  if (!target) throw httpError(404, 'NOT_FOUND', 'User not found');

  const entry = await LedgerEntry.create({
    person,
    createdBy: admin._id,
    kind: 'PAYMENT',
    amount,
    dateYMD,
    date: companyDayFromYMD(dateYMD),
    note: note || '',
  });

  const state = await stateFor(person);
  await notify({
    user: person,
    type: 'DUE_PAYMENT',
    title: `${money(amount)} payment recorded`,
    message: stateLabel(state),
    link: '/dues',
  });

  return { entry: entry.toJSON(), pending: state.pending, advance: state.advance };
}

/** Settle a SINGLE due item — records the remaining cash against just that due. */
export async function settleDue(admin, dueId) {
  assertId(dueId);
  const due = await LedgerEntry.findById(dueId);
  if (!due || due.kind !== 'DUE') throw httpError(404, 'NOT_FOUND', 'Due not found');

  const { remainingById } = await stateFor(due.person);
  const rem = remainingById.get(String(due._id)) ?? Math.max(0, due.amount - (due.paid || 0));
  if (rem <= 0) return { settled: false, message: 'This item is already settled' };

  due.paid = (due.paid || 0) + rem;
  await due.save();

  const state = await stateFor(due.person);
  await notify({
    user: due.person,
    type: 'DUE_SETTLED',
    title: `${money(rem)} settled — ${due.item || 'item'}`,
    message: stateLabel(state),
    link: '/dues',
  });

  return { settled: true, dueId: String(due._id), pending: state.pending, advance: state.advance };
}

/** Settle a person's entire pending — marks every unpaid due as fully paid. */
export async function settle(admin, person) {
  assertId(person);
  const { pending, remainingById } = await stateFor(person);
  if (pending <= 0) return { settled: false, message: 'Nothing pending to settle' };

  const dues = await LedgerEntry.find({ person, kind: 'DUE' });
  for (const d of dues) {
    const rem = remainingById.get(String(d._id)) ?? 0;
    if (rem > 0) {
      d.paid = (d.paid || 0) + rem;
      await d.save();
    }
  }

  const state = await stateFor(person);
  await notify({
    user: person,
    type: 'DUE_SETTLED',
    title: `${money(pending)} settled in full`,
    message: stateLabel(state),
    link: '/dues',
  });

  return { settled: true, pending: state.pending, advance: state.advance };
}

export async function deleteEntry(id) {
  assertId(id);
  const entry = await LedgerEntry.findByIdAndDelete(id);
  if (!entry) throw httpError(404, 'NOT_FOUND', 'Entry not found');
  return { person: entry.person, ...(await stateFor(entry.person)) };
}

export async function exportRows() {
  const docs = await LedgerEntry.find().sort({ date: -1, createdAt: -1 }).limit(10000).populate('person', 'name employeeId');

  const byPerson = new Map();
  for (const d of docs) {
    const pid = String(d.person?._id ?? d.person);
    if (!byPerson.has(pid)) byPerson.set(pid, []);
    byPerson.get(pid).push(d);
  }
  const remaining = new Map();
  for (const list of byPerson.values()) {
    const { remainingById } = computeLedger(list);
    for (const [id, rem] of remainingById) remaining.set(id, rem);
  }

  const header = ['Date', 'Person', 'Employee ID', 'Type', 'Item', 'Source', 'Amount', 'Status', 'Note'];
  const rows = docs.map((e) => {
    let status = 'Credit';
    if (e.kind === 'DUE') {
      const rem = remaining.get(String(e._id)) ?? Math.max(0, e.amount - (e.paid || 0));
      status = rem === 0 ? 'Paid' : rem < e.amount ? 'Partial' : 'Pending';
    }
    return [
      e.dateYMD,
      e.person?.name ?? '',
      e.person?.employeeId ?? '',
      e.kind === 'DUE' ? 'Due' : 'Payment',
      e.item || '',
      e.source || '',
      (e.amount / 100).toFixed(2),
      status,
      (e.note || '').replace(/\s+/g, ' ').trim(),
    ];
  });
  return { header, rows };
}
