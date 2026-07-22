import { Attendance } from '../models/Attendance.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { LeaveBalance } from '../models/LeaveBalance.js';
import { Expense } from '../models/Expense.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { companyDayFromYMD, ymdInTz, formatCompany } from '../lib/time.js';
import { roleLabel } from '../lib/roles.js';
import { splitByJoining, periodStartFor, joinedYMD } from '../lib/joining.js';
import { can } from '../lib/permissions.js';
import { workWindowClosed } from '../lib/schedule.js';
import { leaveYearOf } from '../lib/leaveYear.js';
import { holidayYMDSet } from './holiday.service.js';
import { expenseSummary } from './expense.service.js';
import { ledgerFor } from './dues.service.js';
import { APP_LIVE_YMD } from '../lib/appLive.js';

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

export function computePeriod(type, dateYMD, range) {
  if (type === 'custom') {
    // An arbitrary "x date → y date" window. Fall back to the single date if a
    // side is missing, and always keep from <= to.
    let from = range?.from || dateYMD;
    let to = range?.to || range?.from || dateYMD;
    if (to < from) [from, to] = [to, from];
    return { from, to, label: from === to ? niceDate(from) : `${niceDate(from)} – ${niceDate(to)}` };
  }
  const d = new Date(`${dateYMD}T00:00:00Z`);
  if (type === 'daily') {
    return { from: dateYMD, to: dateYMD, label: niceDate(dateYMD) };
  }
  if (type === 'weekly') {
    // Weeks are counted within the month — 1–7, 8–14, 15–21, 22–28, then whatever is
    // left. Calendar (Mon–Sun) weeks straddle month ends, so a "weekly" report for
    // early July would open on 29 June and read as an arbitrary window; anchoring to
    // the month keeps every report lined up with the month it belongs to.
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth();
    const day = d.getUTCDate();
    const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const startDay = Math.floor((day - 1) / 7) * 7 + 1;
    const endDay = Math.min(startDay + 6, lastDay);
    const from = `${y}-${pad(mo + 1)}-${pad(startDay)}`;
    const to = `${y}-${pad(mo + 1)}-${pad(endDay)}`;
    return { from, to, label: `${niceDate(from)} – ${niceDate(to)}` };
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
  if (type === 'quarterly') {
    // Quarters run with the FISCAL year, not the calendar: Q1 is Apr–Jun. A quarter
    // that straddled the year end would make every quarterly total un-addable to the
    // yearly one.
    const y0 = d.getUTCFullYear();
    const m0 = d.getUTCMonth(); // 0-11
    const fy = m0 + 1 >= 4 ? y0 : y0 - 1;
    const q = Math.floor(((m0 - 3 + 12) % 12) / 3); // 0-3, Apr–Jun = 0
    const startMonth = 3 + q * 3; // months since Jan of the fiscal year's start
    const start = new Date(Date.UTC(fy, startMonth, 1));
    const end = new Date(Date.UTC(fy, startMonth + 3, 0)); // day 0 = last day of the previous month
    const ymd = (x) => `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
    return { from: ymd(start), to: ymd(end), label: `Q${q + 1} FY ${fy}–${String(fy + 1).slice(2)}` };
  }
  // Yearly = the company FISCAL year (Apr 1 – Mar 31), matching leave + expenses.
  const y0 = d.getUTCFullYear();
  const fy = d.getUTCMonth() + 1 >= 4 ? y0 : y0 - 1;
  return { from: `${fy}-04-01`, to: `${fy + 1}-03-31`, label: `FY ${fy}–${String(fy + 1).slice(2)} (Apr–Mar)` };
}

/**
 * The same period, one step earlier — for "up 18% vs last month".
 *
 * Steps the ANCHOR back and re-resolves, so the answer is always a real calendar
 * month/quarter/fiscal year. Subtracting the current period's length instead would
 * put "the month before July" at 31 May – 21 Jun, and February would be worse.
 * A custom window has no calendar predecessor, so it shifts by its own span.
 */
export function previousPeriod(type, dateYMD, range) {
  const cur = computePeriod(type, dateYMD, range);
  if (type === 'custom') {
    const from = new Date(`${cur.from}T00:00:00Z`);
    const to = new Date(`${cur.to}T00:00:00Z`);
    const span = Math.round((to - from) / 86400000) + 1;
    const prevTo = new Date(from.getTime() - 86400000);
    const prevFrom = new Date(prevTo.getTime() - (span - 1) * 86400000);
    const ymd = (x) => x.toISOString().slice(0, 10);
    return { from: ymd(prevFrom), to: ymd(prevTo), label: `previous ${span} days` };
  }
  const d = new Date(`${cur.from}T00:00:00Z`);
  const step = { daily: 0, weekly: 0, monthly: 1, quarterly: 3 }[type];
  const back =
    type === 'daily'
      ? new Date(d.getTime() - 86400000)
      : type === 'weekly'
        ? new Date(d.getTime() - 7 * 86400000)
        : step
          ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - step, 1))
          : new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), 1)); // yearly
  return computePeriod(type, back.toISOString().slice(0, 10), range);
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

export async function buildReport(type, dateYMD, range) {
  const settings = await Setting.getSingleton();
  const period = computePeriod(type, dateYMD, range);
  const { from, to } = period;

  const fromDay = companyDayFromYMD(from);
  const toDay = companyDayFromYMD(to);
  const now = new Date();
  const todayYMD = ymdInTz(now);
  // Today only becomes an "absent-countable" working day once the office day is
  // over — until then a no-show may still turn up. So measure up to the last
  // FINISHED working day (yesterday while today's company hours are still on).
  const companyClosed = formatCompany(now, 'HH:mm') >= settings.workEnd;
  const lastFinishedYMD = companyClosed ? todayYMD : ymdInTz(new Date(now.getTime() - 86400000));
  const elapsedTo = to < lastFinishedYMD ? to : lastFinishedYMD;
  const holidaySet = await holidayYMDSet(from, to);
  const workingDays = from > elapsedTo ? 0 : countWorkingDays(from, elapsedTo, settings.weekendDays, holidaySet);

  const [activeUsers, records, takenLeaves, pendingLeaves, balances, expList, expSummary] = await Promise.all([
    User.find({ isActive: true }).select('name employeeId role department dateOfJoining').sort({ name: 1 }),
    // Count attendance only over the window the report actually claims to cover
    // (from → asOf). Today's check-in must not land in the numerator while today is
    // still missing from the working-day denominator — that produced "18 of 17".
    Attendance.find({ date: { $gte: fromDay, $lte: companyDayFromYMD(elapsedTo < from ? from : elapsedTo) } }),
    LeaveRequest.find({ status: 'APPROVED', startYMD: { $lte: to }, endYMD: { $gte: from } }).populate('user', 'name employeeId'),
    LeaveRequest.find({ status: 'PENDING' }).populate('user', 'name employeeId').sort({ appliedAt: -1 }),
    LeaveBalance.find({ year: leaveYearOf(from) }).populate('user', 'name employeeId'),
    Expense.find({ dateYMD: { $gte: from, $lte: to } }).sort({ dateYMD: -1 }).limit(300).populate('addedBy', 'name'),
    expenseSummary({ from, to }),
  ]);

  // Leadership don't clock in or apply for leave — keep them OUT of the attendance
  // table and the leave-balance table, otherwise they read as permanently "absent"
  // or as unused quota, which is nonsense. (They still appear in the roster.)
  const attendanceRoster = activeUsers.filter((u) => can({ role: u.role }, 'markAttendance'));
  // Nobody is accountable for a period they hadn't joined. People who arrived after it
  // drop out entirely; those who arrived during it are judged only on their own days,
  // so the report never counts a day against someone who had no access.
  const { included: attendanceUsers, joinedLater } = splitByJoining(attendanceRoster, from, elapsedTo || to);
  const leaveUserIds = new Set(activeUsers.filter((u) => can({ role: u.role }, 'applyLeave')).map((u) => String(u._id)));

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

  const perEmployee = attendanceUsers.map((u) => {
    const m = byUser.get(String(u._id)) || { present: 0, late: 0, onLeave: 0, workedMinutes: 0, overtimeMinutes: 0 };
    const showed = m.present + m.late;
    // Their own working-day count: the whole period, or from their joining day if they
    // arrived part-way through.
    const startedOn = periodStartFor(u, from);
    const ownWorkingDays =
      startedOn > elapsedTo ? 0 : countWorkingDays(startedOn, elapsedTo, settings.weekendDays, holidaySet);
    const absent = Math.max(0, ownWorkingDays - showed - m.onLeave);
    return {
      name: u.name,
      joinedYMD: joinedYMD(u),
      startedOn: startedOn > from ? startedOn : '',
      workingDays: ownWorkingDays,
      employeeId: u.employeeId,
      role: u.role,
      roleLabel: roleLabel(u.role),
      // A late employee still showed up — Present counts every attended day;
      // `late` is the "of which came late" indicator, not a separate bucket.
      present: showed,
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
  // Sum each person's own working days rather than headcount × period, so a mid-period
  // joiner doesn't drag the company attendance rate down for days they weren't here.
  const denom = perEmployee.reduce((n, e) => n + (e.workingDays ?? workingDays), 0);
  // `present` already includes late arrivals (they attended).
  totals.attendanceRate = denom > 0 ? Math.round((totals.present / denom) * 100) : 0;

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
    balances: balances
      .filter((b) => b.user && leaveUserIds.has(String(b.user._id)))
      .map((b) => ({
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
    members: activeUsers.map((u) => ({ name: u.name, employeeId: u.employeeId, role: u.role, roleLabel: roleLabel(u.role), department: u.department })),
  };

  // No dues in the company report at all — not even totals. What the office is owed
  // is the admin's ledger, not company reporting. Each person still sees their own
  // entry by entry in their own report, and the Dues page administers them.

  return {
    scope: 'company',
    type,
    date: dateYMD,
    period,
    // When the period hasn't finished yet, everything above only counts days up
    // to `asOfYMD` (today) — upcoming days are NOT counted as absent.
    ongoing: to > todayYMD,
    asOfYMD: elapsedTo,
    generatedAt: new Date().toISOString(),
    company: { name: settings.companyName, currency: settings.currency, timezone: settings.timezone, brandColor: settings.brandColor, logoUrl: settings.logoUrl, logoLight: settings.logoLight, logoDark: settings.logoDark },
    workingDays,
    // People left out of this report because they joined after it — surfaced so a
    // short list reads as "they weren't here yet", not as missing data.
    joinedLater,
    attendance: { perEmployee, totals },
    leaves,
    expenses,
    roster,
  };
}

const STATUS_LABEL = {
  PRESENT: 'Present',
  LATE: 'Present (late)',
  ON_DUTY: 'On-duty',
  ABSENT: 'Absent',
  ON_LEAVE: 'On leave',
  HOLIDAY: 'Holiday',
  WEEKEND: 'Weekend',
  BEFORE_JOINING: 'Not employed yet',
  UPCOMING: '—',
};

/**
 * A single person's own report (attendance day-by-day, leaves, dues) for a period.
 * Available to any signed-in user for THEIR OWN data.
 */
export async function buildSelfReport({ user, type, dateYMD, range }) {
  const settings = await Setting.getSingleton();
  const period = computePeriod(type, dateYMD, range);
  const { from, to } = period;
  const now = new Date();
  const todayYMD = ymdInTz(now);
  const fromDay = companyDayFromYMD(from);
  const toDay = companyDayFromYMD(to);
  const holidaySet = await holidayYMDSet(from, to);
  const weekendDays = settings.weekendDays || [0];
  const joinedOn = joinedYMD(user); // days before this never count for or against them

  const [records, takenLeaves, pendingLeaves, balanceDoc, due] = await Promise.all([
    Attendance.find({ user: user._id, date: { $gte: fromDay, $lte: toDay } }),
    LeaveRequest.find({ user: user._id, status: 'APPROVED', startYMD: { $lte: to }, endYMD: { $gte: from } }).sort({ startYMD: -1 }),
    LeaveRequest.find({ user: user._id, status: 'PENDING' }).sort({ appliedAt: -1 }),
    LeaveBalance.findOne({ user: user._id, year: leaveYearOf(from) }),
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
      if (rec.checkInAt) checkIn = formatCompany(rec.checkInAt, 'HH:mm');
      if (rec.checkOutAt) checkOut = formatCompany(rec.checkOutAt, 'HH:mm');
      workedHours = round1((rec.workedMinutes || 0) / 60);
      overtimeMinutes = rec.overtimeMinutes || 0;
    } else if (holidaySet.has(ymd)) {
      status = 'HOLIDAY';
    } else if (ymd < joinedOn || ymd < APP_LIVE_YMD) {
      // Days before this person had access aren't theirs to answer for — and neither
      // are days before the office ran on this system at all. The fiscal year opens on
      // 1 April but nothing was recorded until 1 July, so without this a yearly report
      // for anyone with a genuine older joining date would mark three months absent
      // for days that were simply never tracked.
      status = 'BEFORE_JOINING';
    } else if (weekendDays.includes(dow)) {
      status = 'WEEKEND';
    } else if (!workWindowClosed(user, ymd, settings, now)) {
      // Future days, and today before the office day is over — not absent yet.
      status = 'UPCOMING';
    } else {
      status = 'ABSENT';
    }
    days.push({ ymd, weekday, status, statusLabel: STATUS_LABEL[status] || status, checkIn, checkOut, workedHours, overtimeMinutes });
    cur = new Date(cur.getTime() + 86400000);
  }

  const tally = (s) => days.filter((d) => d.status === s).length;
  const late = tally('LATE');
  const onDuty = tally('ON_DUTY');
  // A late day is still an attended day — Present counts every day they showed
  // up; `late` stays as the "of which came late" indicator.
  const present = tally('PRESENT') + late + onDuty;
  const absent = tally('ABSENT');
  const onLeave = tally('ON_LEAVE');
  const workingDays = present + absent + onLeave;
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
    attendanceRate: workingDays > 0 ? Math.round((present / workingDays) * 100) : 0,
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
    // Ongoing period: day-by-day marks future days as "Upcoming" (not absent);
    // the totals above only cover days up to `asOfYMD` (today).
    ongoing: to > todayYMD,
    asOfYMD: to < todayYMD ? to : todayYMD,
    generatedAt: new Date().toISOString(),
    company: { name: settings.companyName, currency: settings.currency, timezone: settings.timezone, brandColor: settings.brandColor, logoUrl: settings.logoUrl, logoLight: settings.logoLight, logoDark: settings.logoDark },
    subject: { name: user.name, employeeId: user.employeeId, role: user.role, roleLabel: roleLabel(user.role), department: user.department || '' },
    attendance: { days, totals: attTotals },
    leaves,
    dues,
  };
}
