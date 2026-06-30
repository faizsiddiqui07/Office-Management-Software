import { Attendance } from '../models/Attendance.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { LeaveBalance } from '../models/LeaveBalance.js';
import { Expense } from '../models/Expense.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { companyDayFromYMD, ymdInTz, formatCompany } from '../lib/time.js';
import { holidayYMDSet } from './holiday.service.js';
import { expenseSummary } from './expense.service.js';
import { ledgerFor, overview as duesOverview } from './dues.service.js';

const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function niceDate(ymd) {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function computePeriod(type, dateYMD) {
  const d = new Date(`${dateYMD}T00:00:00Z`);
  if (type === 'daily') {
    return { from: dateYMD, to: dateYMD, label: niceDate(dateYMD) };
  }
  if (type === 'weekly') {
    const dow = d.getUTCDay(); // 0=Sun
    const toMonday = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(d.getTime() + toMonday * 86400000);
    const sun = new Date(mon.getTime() + 6 * 86400000);
    return { from: ymdOf(mon), to: ymdOf(sun), label: `Week of ${niceDate(ymdOf(mon))}` };
  }
  if (type === 'monthly') {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return {
      from: `${y}-${pad(m + 1)}-01`,
      to: `${y}-${pad(m + 1)}-${pad(last)}`,
      label: new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    };
  }
  const y = d.getUTCFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
}

function countWorkingDays(fromYMD, toYMD, weekendDays, holidaySet) {
  if (toYMD < fromYMD) return 0;
  let count = 0;
  let d = new Date(`${fromYMD}T00:00:00Z`);
  const end = new Date(`${toYMD}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    const ymd = d.toISOString().slice(0, 10);
    if (!weekendDays.includes(d.getUTCDay()) && !holidaySet.has(ymd)) count += 1;
    d = new Date(d.getTime() + 86400000);
  }
  return count;
}

const round1 = (n) => Math.round(n * 10) / 10;

export async function buildReport(type, dateYMD) {
  const settings = await Setting.getSingleton();
  const period = computePeriod(type, dateYMD);
  const { from, to } = period;

  const fromDay = companyDayFromYMD(from);
  const toDay = companyDayFromYMD(to);
  const todayYMD = ymdInTz(new Date());
  const elapsedTo = to < todayYMD ? to : todayYMD;
  const holidaySet = await holidayYMDSet(from, to);
  const workingDays = from > elapsedTo ? 0 : countWorkingDays(from, elapsedTo, settings.weekendDays, holidaySet);

  const [activeUsers, records, takenLeaves, pendingLeaves, balances, expList, expSummary, dues] = await Promise.all([
    User.find({ isActive: true }).select('name employeeId role department').sort({ name: 1 }),
    Attendance.find({ date: { $gte: fromDay, $lte: toDay } }),
    LeaveRequest.find({ status: 'APPROVED', startYMD: { $lte: to }, endYMD: { $gte: from } }).populate('user', 'name employeeId'),
    LeaveRequest.find({ status: 'PENDING' }).populate('user', 'name employeeId').sort({ appliedAt: -1 }),
    LeaveBalance.find({ year: Number(from.slice(0, 4)) }).populate('user', 'name employeeId'),
    Expense.find({ dateYMD: { $gte: from, $lte: to } }).sort({ dateYMD: -1 }).limit(300).populate('addedBy', 'name'),
    expenseSummary({ from, to }),
    duesOverview(),
  ]);

  // ── Attendance per employee ───────────────────────────────
  const byUser = new Map();
  for (const r of records) {
    const uid = String(r.user);
    if (!byUser.has(uid)) byUser.set(uid, { present: 0, late: 0, onLeave: 0, workedMinutes: 0, overtimeMinutes: 0 });
    const m = byUser.get(uid);
    if (r.status === 'PRESENT') m.present += 1;
    else if (r.status === 'LATE') {
      if (r.excused) m.present += 1; // excused (on-duty) late counts as present, not late
      else m.late += 1;
    } else if (r.status === 'ON_LEAVE') m.onLeave += 1;
    m.workedMinutes += r.workedMinutes || 0;
    m.overtimeMinutes += r.overtimeMinutes || 0;
  }

  const perEmployee = activeUsers.map((u) => {
    const m = byUser.get(String(u._id)) || { present: 0, late: 0, onLeave: 0, workedMinutes: 0, overtimeMinutes: 0 };
    const showed = m.present + m.late;
    const absent = Math.max(0, workingDays - showed - m.onLeave);
    return {
      name: u.name,
      employeeId: u.employeeId,
      role: u.role,
      present: m.present,
      late: m.late,
      absent,
      onLeave: m.onLeave,
      workedHours: round1(m.workedMinutes / 60),
      overtimeMinutes: m.overtimeMinutes,
    };
  });

  const totals = perEmployee.reduce(
    (acc, e) => {
      acc.present += e.present;
      acc.late += e.late;
      acc.absent += e.absent;
      acc.onLeave += e.onLeave;
      acc.workedHours += e.workedHours;
      acc.overtimeMinutes += e.overtimeMinutes;
      return acc;
    },
    { present: 0, late: 0, absent: 0, onLeave: 0, workedHours: 0, overtimeMinutes: 0 },
  );
  totals.workedHours = round1(totals.workedHours);
  const denom = activeUsers.length * workingDays;
  totals.attendanceRate = denom > 0 ? Math.round(((totals.present + totals.late) / denom) * 100) : 0;

  // ── Leaves ────────────────────────────────────────────────
  const leaves = {
    taken: takenLeaves.map((l) => ({
      name: l.user?.name ?? '—',
      employeeId: l.user?.employeeId ?? '',
      type: l.type,
      startYMD: l.startYMD,
      endYMD: l.endYMD,
      days: l.workingDays,
    })),
    pending: pendingLeaves.map((l) => ({
      name: l.user?.name ?? '—',
      type: l.type,
      startYMD: l.startYMD,
      endYMD: l.endYMD,
      days: l.workingDays,
    })),
    balances: balances.map((b) => ({
      name: b.user?.name ?? '—',
      employeeId: b.user?.employeeId ?? '',
      used: b.used,
      remaining: b.remaining,
      total: b.totalQuota,
    })),
  };

  // ── Expenses ──────────────────────────────────────────────
  const expenses = {
    total: expSummary.total,
    count: expSummary.count,
    currency: settings.currency,
    byCategory: expSummary.byCategory,
    list: expList.map((e) => ({
      title: e.title,
      vendor: e.vendor,
      category: e.category,
      paymentMethod: e.paymentMethod,
      amount: e.amount,
      dateYMD: e.dateYMD,
    })),
  };

  // ── Roster ────────────────────────────────────────────────
  const byRole = {};
  for (const u of activeUsers) byRole[u.role] = (byRole[u.role] || 0) + 1;
  const roster = {
    headcount: activeUsers.length,
    byRole,
    members: activeUsers.map((u) => ({ name: u.name, employeeId: u.employeeId, role: u.role, department: u.department })),
  };

  // ── Dues ledger (company-wide) ────────────────────────────
  const duesSection = {
    currency: settings.currency,
    totalPending: dues.totalPending,
    totalAdvance: dues.totalAdvance,
    owingCount: dues.owingCount,
    people: dues.people
      .filter((p) => p.pending > 0 || p.advance > 0)
      .map((p) => ({
        name: p.person.name,
        employeeId: p.person.employeeId,
        role: p.person.role,
        pending: p.pending,
        advance: p.advance,
      })),
  };

  return {
    scope: 'company',
    type,
    date: dateYMD,
    period,
    generatedAt: new Date().toISOString(),
    company: { name: settings.companyName, currency: settings.currency, timezone: settings.timezone, brandColor: settings.brandColor, logoUrl: settings.logoUrl, logoLight: settings.logoLight, logoDark: settings.logoDark },
    workingDays,
    attendance: { perEmployee, totals },
    leaves,
    expenses,
    roster,
    dues: duesSection,
  };
}

const STATUS_LABEL = {
  PRESENT: 'Present',
  LATE: 'Late',
  ON_DUTY: 'On-duty',
  ABSENT: 'Absent',
  ON_LEAVE: 'On leave',
  HOLIDAY: 'Holiday',
  WEEKEND: 'Weekend',
  UPCOMING: '—',
};

/**
 * A single person's own report (attendance day-by-day, leaves, dues) for a period.
 * Available to any signed-in user for THEIR OWN data.
 */
export async function buildSelfReport({ user, type, dateYMD }) {
  const settings = await Setting.getSingleton();
  const period = computePeriod(type, dateYMD);
  const { from, to } = period;
  const todayYMD = ymdInTz(new Date());
  const fromDay = companyDayFromYMD(from);
  const toDay = companyDayFromYMD(to);
  const holidaySet = await holidayYMDSet(from, to);
  const weekendDays = settings.weekendDays || [0];

  const [records, takenLeaves, pendingLeaves, balanceDoc, due] = await Promise.all([
    Attendance.find({ user: user._id, date: { $gte: fromDay, $lte: toDay } }),
    LeaveRequest.find({ user: user._id, status: 'APPROVED', startYMD: { $lte: to }, endYMD: { $gte: from } }).sort({ startYMD: -1 }),
    LeaveRequest.find({ user: user._id, status: 'PENDING' }).sort({ appliedAt: -1 }),
    LeaveBalance.findOne({ user: user._id, year: Number(from.slice(0, 4)) }),
    ledgerFor(user._id),
  ]);

  // ── Day-by-day attendance ─────────────────────────────────
  const byYmd = new Map();
  // Key by the COMPANY-timezone day (records store the TZ-midnight instant);
  // using UTC here would shift check-ins to the wrong calendar day.
  for (const r of records) byYmd.set(ymdInTz(new Date(r.date)), r);

  const days = [];
  let cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur.getTime() <= end.getTime()) {
    const ymd = cur.toISOString().slice(0, 10);
    const dow = cur.getUTCDay();
    const weekday = cur.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
    const rec = byYmd.get(ymd);
    let status;
    let checkIn = '';
    let checkOut = '';
    let workedHours = 0;
    let overtimeMinutes = 0;
    if (rec) {
      status = rec.status === 'LATE' && rec.excused ? 'ON_DUTY' : rec.status;
      if (rec.checkInAt) checkIn = formatCompany(rec.checkInAt, 'hh:mm a');
      if (rec.checkOutAt) checkOut = formatCompany(rec.checkOutAt, 'hh:mm a');
      workedHours = round1((rec.workedMinutes || 0) / 60);
      overtimeMinutes = rec.overtimeMinutes || 0;
    } else if (holidaySet.has(ymd)) {
      status = 'HOLIDAY';
    } else if (weekendDays.includes(dow)) {
      status = 'WEEKEND';
    } else if (ymd > todayYMD) {
      status = 'UPCOMING';
    } else {
      status = 'ABSENT';
    }
    days.push({ ymd, weekday, status, statusLabel: STATUS_LABEL[status] || status, checkIn, checkOut, workedHours, overtimeMinutes });
    cur = new Date(cur.getTime() + 86400000);
  }

  const tally = (s) => days.filter((d) => d.status === s).length;
  const present = tally('PRESENT');
  const late = tally('LATE');
  const onDuty = tally('ON_DUTY');
  const absent = tally('ABSENT');
  const onLeave = tally('ON_LEAVE');
  const workingDays = present + late + onDuty + absent + onLeave;
  const attTotals = {
    present,
    late,
    onDuty,
    absent,
    onLeave,
    holidays: tally('HOLIDAY'),
    weekends: tally('WEEKEND'),
    workingDays,
    workedHours: round1(days.reduce((s, d) => s + d.workedHours, 0)),
    overtimeMinutes: days.reduce((s, d) => s + d.overtimeMinutes, 0),
    attendanceRate: workingDays > 0 ? Math.round(((present + late + onDuty) / workingDays) * 100) : 0,
  };

  // ── Leaves ────────────────────────────────────────────────
  const leaves = {
    taken: takenLeaves.map((l) => ({ type: l.type, startYMD: l.startYMD, endYMD: l.endYMD, days: l.workingDays, reason: l.reason || '' })),
    pending: pendingLeaves.map((l) => ({ type: l.type, startYMD: l.startYMD, endYMD: l.endYMD, days: l.workingDays })),
    balance: balanceDoc
      ? { used: balanceDoc.used, remaining: balanceDoc.remaining, total: balanceDoc.totalQuota }
      : { used: 0, remaining: settings.annualLeaveQuota, total: settings.annualLeaveQuota },
  };

  // ── Dues (current balance + entries in the period) ────────
  const dues = {
    currency: settings.currency,
    pending: due.pending,
    advance: due.advance,
    entries: due.entries
      .filter((e) => e.dateYMD >= from && e.dateYMD <= to)
      .map((e) => ({
        dateYMD: e.dateYMD,
        kind: e.kind,
        item: e.item || '',
        source: e.source || '',
        amount: e.amount,
        status: e.kind === 'DUE' ? e.status : 'PAYMENT',
        note: e.note || '',
      })),
  };

  return {
    scope: 'me',
    type,
    date: dateYMD,
    period,
    generatedAt: new Date().toISOString(),
    company: { name: settings.companyName, currency: settings.currency, timezone: settings.timezone, brandColor: settings.brandColor, logoUrl: settings.logoUrl, logoLight: settings.logoLight, logoDark: settings.logoDark },
    subject: { name: user.name, employeeId: user.employeeId, role: user.role, department: user.department || '' },
    attendance: { days, totals: attTotals },
    leaves,
    dues,
  };
}
