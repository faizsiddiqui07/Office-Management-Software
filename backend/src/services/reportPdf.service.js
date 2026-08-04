import { createElement as E } from 'react';
import { Document, Page, View, Text, Image, StyleSheet, renderToStream } from '@react-pdf/renderer';

const DEFAULT_ACCENT = '#E5342B';
const HEADER_BG = '#1B1F2A'; // dark band so a light/transparent logo stays crisp
const INK = '#1f2430';
const MUTE = '#6b7280';
const HAIR = '#e5e7eb';

const ROLE_LABELS = {
  CEO: 'CEO',
  DIRECTOR: 'Director',
  ADMIN_MANAGER: 'Admin Manager',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
  OFFICE_BOY: 'Office Boy',
  SECURITY: 'Security Guard',
};

const STATUS_COLOR = {
  PRESENT: '#16a34a',
  ON_DUTY: '#16a34a',
  LATE: '#d97706',
  ABSENT: '#dc2626',
  ON_LEAVE: '#2563eb',
  WFH: '#0891b2', // worked, from home — distinct from leave's blue and present's green
  HOLIDAY: '#7c3aed',
  WEEKEND: '#9ca3af',
  UPCOMING: '#9ca3af',
};

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 52, paddingHorizontal: 36, fontSize: 9, color: INK, fontFamily: 'Helvetica' },

  // Branded header band
  band: { backgroundColor: HEADER_BG, borderRadius: 8, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logo: { height: 34, width: 170, objectFit: 'contain', objectPositionX: 0 },
  bandCompany: { color: '#ffffff', fontSize: 16, fontFamily: 'Helvetica-Bold' },
  bandRight: { alignItems: 'flex-end' },
  bandTitle: { color: '#ffffff', fontSize: 12, fontFamily: 'Helvetica-Bold' },
  bandSub: { color: '#c7cbd4', fontSize: 8, marginTop: 2 },
  accentBar: { height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, marginBottom: 10, marginTop: -1 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  meta: { fontSize: 8, color: MUTE },

  // Subject (personal report)
  subjectCard: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#f6f7f9', borderRadius: 6, padding: 10, marginBottom: 6 },
  subjectItem: { width: '25%', paddingVertical: 2 },
  subjectLabel: { fontSize: 7, color: MUTE, textTransform: 'uppercase' },
  subjectValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 1 },

  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 16, marginBottom: 6 },
  subTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4, color: INK },

  statRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  stat: { width: '25%', paddingVertical: 4 },
  statLabel: { fontSize: 7, color: MUTE, textTransform: 'uppercase' },
  statValue: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 1 },

  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#eef0f3', paddingVertical: 4 },
  trHeader: { borderBottomWidth: 1, borderBottomColor: '#cbd0d8' },
  trAlt: { backgroundColor: '#fafbfc' },
  td: { paddingRight: 6 },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: MUTE, textTransform: 'uppercase' },
  muted: { color: MUTE },
  empty: { fontSize: 8, color: '#9ca3af', marginTop: 2 },

  footer: {
    position: 'absolute', bottom: 22, left: 36, right: 36,
    flexDirection: 'row', justifyContent: 'space-between',
    fontSize: 7, color: '#9ca3af', borderTopWidth: 0.5, borderTopColor: HAIR, paddingTop: 6,
  },
});

function money(paise) {
  return `Rs ${((paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function dur(min) {
  const total = Math.max(0, Math.round(min || 0));
  const hrs = Math.floor(total / 60);
  const rem = total % 60;
  if (hrs && rem) return `${hrs}h ${rem}m`;
  if (hrs) return `${hrs}h`;
  return `${rem}m`;
}
function cap(role) {
  return ROLE_LABELS[role] || role;
}
function range(a, b) {
  return a === b ? a : `${a} – ${b}`;
}
function dayLabel(ymd, weekday) {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mon = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${weekday} ${dd} ${mon}`;
}

function tableRow(cells, key, opts = {}) {
  const { header: isHeader, alt } = opts;
  return E(
    View,
    { key, style: [styles.tr, isHeader ? styles.trHeader : null, alt ? styles.trAlt : null] },
    cells.map((c, i) =>
      E(
        Text,
        {
          key: i,
          style: [styles.td, { width: c.w, textAlign: c.align || 'left' }, isHeader ? styles.th : null, c.color ? { color: c.color, fontFamily: 'Helvetica-Bold' } : null],
        },
        String(c.text ?? ''),
      ),
    ),
  );
}

function table(headers, rows) {
  const head = tableRow(headers.map((h) => ({ text: h.label, w: h.w, align: h.align })), 'head', { header: true });
  const body = rows.map((r, ri) =>
    tableRow(
      headers.map((h, ci) => {
        const cell = r[ci];
        return cell && typeof cell === 'object' ? { ...cell, w: h.w, align: h.align } : { text: cell, w: h.w, align: h.align };
      }),
      `r${ri}`,
      { alt: ri % 2 === 1 },
    ),
  );
  return E(View, { wrap: true }, head, ...body);
}

function stat(label, value, key) {
  return E(View, { key, style: styles.stat }, E(Text, { style: styles.statLabel }, label), E(Text, { style: styles.statValue }, String(value)));
}

function sectionTitle(text, accent) {
  return E(Text, { style: [styles.sectionTitle, { color: accent }] }, text);
}

/* ── Header / footer ─────────────────────────────────────── */
function header(data, logo, accent, titleLabel) {
  const left = logo
    ? E(Image, { src: logo.dataUri, style: styles.logo })
    : E(Text, { style: styles.bandCompany }, data.company.name);
  return E(
    View,
    {},
    E(
      View,
      { style: styles.band },
      left,
      E(View, { style: styles.bandRight }, E(Text, { style: styles.bandTitle }, titleLabel), E(Text, { style: styles.bandSub }, data.period.label)),
    ),
    E(View, { style: [styles.accentBar, { backgroundColor: accent }] }),
  );
}

function metaLine(data) {
  // Pin to company time — Lambda runs in UTC, so without a timeZone this one line came
  // out ~5.5h behind every other (IST) date in the document.
  const generatedOn = new Date(data.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  const wd = data.workingDays ?? data.attendance?.totals?.workingDays;
  const wdText = wd != null ? ` (${wd} working days so far)` : '';
  return E(
    View,
    {},
    E(
      View,
      { style: styles.metaRow },
      E(Text, { style: styles.meta }, `Period: ${data.period.from} to ${data.period.to}`),
      E(Text, { style: styles.meta }, `Generated: ${generatedOn}`),
    ),
    // Ongoing period: spell out that only elapsed days are counted, so the
    // uncounted future isn't misread as everyone being absent.
    data.ongoing
      ? E(
          Text,
          { style: { fontSize: 8, color: '#b45309', marginTop: 4 } },
          `Period in progress — figures cover ${data.period.from} to ${data.asOfYMD}${wdText}. Upcoming days are not counted.`,
        )
      : null,
  );
}

function footer(data, titleLabel) {
  return E(Text, {
    style: styles.footer,
    fixed: true,
    render: ({ pageNumber, totalPages }) => `${data.company.name} · ${titleLabel}    ·    Page ${pageNumber} of ${totalPages}`,
  });
}

/* ── Company sections ────────────────────────────────────── */
/**
 * Who did how much work in this period — the first thing the report answers.
 *
 * Only DELEGATED work is counted, judged on the day it was submitted (for approval
 * tasks) or completed, with the configured grace days before anything counts as late —
 * the same rule the bonus system and the leaderboard use. "Tagged" is beside those
 * figures, never inside them: being kept in the loop is not doing the work.
 */
function companyTasksSection(d, accent) {
  const t = d.tasks || { perEmployee: [], totals: { done: 0, onTime: 0, late: 0, tagged: 0 } };
  const tot = t.totals;
  const stats = [
    stat('Tasks done', tot.done, 'ct1'),
    stat('On time', tot.onTime, 'ct2'),
    stat('Late', tot.late, 'ct3'),
    stat('Tagged on', tot.tagged, 'ct4'),
  ];
  const headers = [
    { label: 'Employee', w: '30%' },
    { label: 'ID', w: '14%' },
    { label: 'Done', w: '14%', align: 'right' },
    { label: 'On time', w: '14%', align: 'right' },
    { label: 'Late', w: '14%', align: 'right' },
    { label: 'Tagged', w: '14%', align: 'right' },
  ];
  const rows = t.perEmployee.map((e) => [e.name, e.employeeId, e.done, e.onTime, e.late, e.tagged]);
  return E(
    View,
    { key: 'tasks' },
    sectionTitle('Tasks', accent),
    E(View, { style: styles.statRow }, ...stats),
    rows.length ? table(headers, rows) : E(Text, { style: styles.empty }, 'No task activity in this period.'),
    E(
      Text,
      { style: styles.empty },
      `Assigned work only — personal to-dos aren’t counted. Late means finished more than ${t.graceDays ?? 1} day${(t.graceDays ?? 1) === 1 ? '' : 's'} past the due date; a task with no deadline counts as on time, so done always equals on time + late. “Tagged” is work raised in this period that named the person as a colleague — somebody else’s task, not counted in the figures above.`,
    ),
  );
}

function attendanceSection(d, accent) {
  const t = d.attendance.totals;
  const stats = [
    stat('Attendance rate', `${t.attendanceRate}%`, 's1'),
    stat('Working days', d.workingDays, 's2'),
    stat('Present', t.present, 's3'),
    stat('Came late', t.late, 's4'),
    stat('Absent', t.absent, 's5'),
    stat('On leave', t.onLeave, 's6'),
    stat('From home', t.wfh ?? 0, 's7'),
    stat('Worked hours', dur(t.workedMinutes), 's8'),
    stat('Overtime', dur(t.overtimeMinutes), 's9'),
  ];
  // Widths must total 100% — re-proportioned to fit the WFH column in.
  const headers = [
    { label: 'Employee', w: '23%' },
    { label: 'ID', w: '12%' },
    { label: 'Present', w: '9%', align: 'right' },
    { label: 'Late', w: '8%', align: 'right' },
    { label: 'Absent', w: '9%', align: 'right' },
    { label: 'Leave', w: '8%', align: 'right' },
    { label: 'WFH', w: '8%', align: 'right' },
    { label: 'Worked', w: '13%', align: 'right' },
    { label: 'OT', w: '10%', align: 'right' },
  ];
  const rows = d.attendance.perEmployee.map((e) => [e.name, e.employeeId, e.present, e.late, e.absent, e.onLeave, e.wfh ?? 0, dur(e.workedMinutes), dur(e.overtimeMinutes)]);
  return E(View, { key: 'attendance' }, sectionTitle('Attendance summary', accent), E(View, { style: styles.statRow }, ...stats), table(headers, rows));
}

function leavesSection(d, accent) {
  const takenHeaders = [
    { label: 'Employee', w: '30%' },
    { label: 'Type', w: '16%' },
    { label: 'Dates', w: '40%' },
    { label: 'Days', w: '14%', align: 'right' },
  ];
  const takenRows = d.leaves.taken.map((l) => [l.name, l.type, range(l.startYMD, l.endYMD), l.days]);
  const balHeaders = [
    { label: 'Employee', w: '46%' },
    { label: 'Used', w: '18%', align: 'right' },
    { label: 'Remaining', w: '18%', align: 'right' },
    { label: 'Quota', w: '18%', align: 'right' },
  ];
  const balRows = d.leaves.balances.map((b) => [b.name, b.used, b.remaining, b.total]);
  return E(
    View,
    { key: 'leaves' },
    sectionTitle('Leave summary', accent),
    E(Text, { style: styles.muted }, `Approved leaves in period: ${d.leaves.taken.length}  ·  Pending requests: ${d.leaves.pending.length}`),
    takenRows.length ? table(takenHeaders, takenRows) : E(Text, { style: styles.empty }, 'No approved leaves in this period.'),
    E(Text, { style: styles.subTitle }, 'Remaining balances'),
    balRows.length ? table(balHeaders, balRows) : E(Text, { style: styles.empty }, 'No balances.'),
  );
}

function expensesSection(d, accent) {
  const catHeaders = [
    { label: 'Category', w: '70%' },
    { label: 'Amount', w: '30%', align: 'right' },
  ];
  const catRows = d.expenses.byCategory.map((c) => [c.category.replace(/_/g, ' '), money(c.total)]);
  const listHeaders = [
    { label: 'Date', w: '14%' },
    { label: 'Title', w: '30%' },
    { label: 'Category', w: '20%' },
    { label: 'Method', w: '16%' },
    { label: 'Amount', w: '20%', align: 'right' },
  ];
  const listRows = d.expenses.list.map((e) => [e.dateYMD, e.title, e.category.replace(/_/g, ' '), (e.paymentMethod || '').replace(/_/g, ' '), money(e.amount)]);
  return E(
    View,
    { key: 'expenses' },
    sectionTitle('Expense summary', accent),
    E(Text, { style: styles.muted }, `Total: ${money(d.expenses.total)}  ·  ${d.expenses.count} entries`),
    catRows.length ? table(catHeaders, catRows) : E(Text, { style: styles.empty }, 'No expenses in this period.'),
    listRows.length
      ? E(Text, { style: styles.subTitle }, d.expenses.listCapped ? `Expense list (latest ${d.expenses.listCount} of ${d.expenses.count})` : 'Expense list')
      : null,
    // Make it explicit that the itemised rows don't sum to the total above when capped.
    d.expenses.listCapped ? E(Text, { style: styles.empty }, `Only the ${d.expenses.listCount} most recent entries are listed; the total and category figures above cover all ${d.expenses.count}.`) : null,
    listRows.length ? table(listHeaders, listRows) : null,
  );
}

function rosterSection(d, accent) {
  const byRole = Object.entries(d.roster.byRole)
    .map(([r, n]) => `${cap(r)}: ${n}`)
    .join('   ·   ');
  const headers = [
    { label: 'Name', w: '34%' },
    { label: 'ID', w: '16%' },
    { label: 'Role', w: '26%' },
    { label: 'Department', w: '24%' },
  ];
  const rows = d.roster.members.map((m) => [m.name, m.employeeId, cap(m.role), m.department || '—']);
  return E(
    View,
    { key: 'roster' },
    sectionTitle('Headcount & roster', accent),
    E(Text, { style: styles.muted }, `Headcount: ${d.roster.headcount}    ${byRole}`),
    table(headers, rows),
  );
}

// No dues section in the company PDF: a report gets forwarded and printed, and the
// office ledger has no business travelling inside it. Personal reports still carry
// the reader's own dues (selfDuesSection below).
const COMPANY_SECTIONS = {
  tasks: companyTasksSection,
  attendance: attendanceSection,
  leaves: leavesSection,
  expenses: expensesSection,
  roster: rosterSection,
};
// Tasks first: what the office actually got done is the headline the report opens with.
const COMPANY_ORDER = ['tasks', 'attendance', 'leaves', 'expenses', 'roster'];

function buildCompanyDoc(data, sections, logo) {
  const accent = data.company.brandColor || DEFAULT_ACCENT;
  const typeLabel = `${data.type.charAt(0).toUpperCase()}${data.type.slice(1)} report`;
  const body = COMPANY_ORDER.filter((s) => sections.includes(s)).map((s) => COMPANY_SECTIONS[s](data, accent));
  return E(
    Document,
    {},
    E(Page, { size: 'A4', style: styles.page, wrap: true }, header(data, logo, accent, typeLabel), metaLine(data), ...body, footer(data, typeLabel)),
  );
}

/* ── Personal (self) sections ────────────────────────────── */
function selfSubject(d) {
  const s = d.subject;
  return E(
    View,
    { style: styles.subjectCard },
    E(View, { style: styles.subjectItem }, E(Text, { style: styles.subjectLabel }, 'Employee'), E(Text, { style: styles.subjectValue }, s.name)),
    E(View, { style: styles.subjectItem }, E(Text, { style: styles.subjectLabel }, 'Employee ID'), E(Text, { style: styles.subjectValue }, s.employeeId || '—')),
    E(View, { style: styles.subjectItem }, E(Text, { style: styles.subjectLabel }, 'Role'), E(Text, { style: styles.subjectValue }, s.roleLabel || cap(s.role))),
    E(View, { style: styles.subjectItem }, E(Text, { style: styles.subjectLabel }, 'Department'), E(Text, { style: styles.subjectValue }, s.department || '—')),
  );
}

/** Task stats — totals only, no list. Own work and tagged work are kept apart. */
function selfTasksSection(d, accent) {
  const t = d.tasks || { total: 0, pending: 0, done: 0, onTime: 0, late: 0, overdue: 0 };
  const assigned = t.assigned || null;
  const tagged = t.tagged || null;
  const stats = [
    stat('Total tasks', t.total, 'tk1'),
    stat('Pending', t.pending, 'tk2'),
    stat('Done', t.done, 'tk3'),
    stat('Done on time', t.onTime, 'tk4'),
    stat('Done late', t.late, 'tk5'),
    stat('Overdue', t.overdue, 'tk6'),
    // Of their own tasks, how many were DELEGATED to them — the kind that counts for
    // points and for the company's task figures.
    ...(assigned ? [stat('Of these, assigned', assigned.total, 'tk7')] : []),
  ];
  return E(
    View,
    { key: 'tasks' },
    sectionTitle('Tasks', accent),
    E(View, { style: styles.statRow }, ...stats),
    t.total === 0 ? E(Text, { style: styles.empty }, 'No tasks in this period.') : null,
    // Tagged work sits in its own row, plainly labelled, so it can never be read as part
    // of the totals above.
    tagged && tagged.total > 0
      ? E(
          View,
          { key: 'tg' },
          E(Text, { style: styles.subTitle }, 'Tagged — kept in the loop (not counted above)'),
          E(
            View,
            { style: styles.statRow },
            stat('Tagged on', tagged.total, 'tg1'),
            stat('Pending', tagged.pending, 'tg2'),
            stat('Done', tagged.done, 'tg3'),
          ),
        )
      : null,
  );
}

function selfAttendanceSection(d, accent) {
  const t = d.attendance.totals;
  const stats = [
    stat('Attendance rate', `${t.attendanceRate}%`, 's1'),
    stat('Working days', t.workingDays, 's2'),
    stat('Present', t.present, 's3'),
    stat('Came late', t.late, 's4'),
    stat('On-duty', t.onDuty ?? 0, 's4b'),
    stat('Absent', t.absent, 's5'),
    stat('On leave', t.onLeave, 's6'),
    stat('From home', t.wfh ?? 0, 's6b'),
    stat('Worked hours', dur(t.workedMinutes), 's7'),
    stat('Overtime', dur(t.overtimeMinutes), 's8'),
  ];
  const headers = [
    { label: 'Date', w: '22%' },
    { label: 'Status', w: '16%' },
    { label: 'Check in', w: '17%' },
    { label: 'Check out', w: '17%' },
    { label: 'Worked', w: '14%', align: 'right' },
    { label: 'OT', w: '14%', align: 'right' },
  ];
  const rows = d.attendance.days.map((day) => [
    dayLabel(day.ymd, day.weekday),
    { text: day.statusLabel, color: STATUS_COLOR[day.status] },
    day.checkIn || '—',
    day.checkOut || '—',
    day.workedMinutes ? dur(day.workedMinutes) : '—',
    day.overtimeMinutes ? dur(day.overtimeMinutes) : '—',
  ]);
  return E(
    View,
    { key: 'attendance' },
    sectionTitle('Attendance', accent),
    E(View, { style: styles.statRow }, ...stats),
    E(Text, { style: styles.subTitle }, 'Day-by-day'),
    table(headers, rows),
  );
}

function selfLeavesSection(d, accent) {
  const b = d.leaves.balance;
  const stats = [
    stat('Leave used', b.used, 'l1'),
    stat('Remaining', b.remaining, 'l2'),
    stat('Annual quota', b.total, 'l3'),
    stat('Taken (period)', d.leaves.taken.length, 'l4'),
  ];
  const headers = [
    { label: 'Type', w: '20%' },
    { label: 'Dates', w: '40%' },
    { label: 'Days', w: '12%', align: 'right' },
    { label: 'Reason', w: '28%' },
  ];
  const rows = d.leaves.taken.map((l) => [l.type, range(l.startYMD, l.endYMD), l.days, l.reason || '—']);
  const pendingRows = d.leaves.pending.map((l) => [l.type, range(l.startYMD, l.endYMD), l.days, 'Pending']);
  return E(
    View,
    { key: 'leaves' },
    sectionTitle('Leaves', accent),
    E(View, { style: styles.statRow }, ...stats),
    rows.length ? E(Text, { style: styles.subTitle }, 'Approved in this period') : null,
    rows.length ? table(headers, rows) : E(Text, { style: styles.empty }, 'No approved leaves in this period.'),
    pendingRows.length ? E(Text, { style: styles.subTitle }, 'Pending requests') : null,
    pendingRows.length ? table(headers, pendingRows) : null,
  );
}

function selfDuesSection(d, accent) {
  const stats = [stat('Pending', money(d.dues.pending), 'd1'), stat('Advance', money(d.dues.advance), 'd2'), stat('Entries (period)', d.dues.entries.length, 'd3')];
  const headers = [
    { label: 'Date', w: '15%' },
    { label: 'Type', w: '13%' },
    { label: 'Item', w: '26%' },
    { label: 'Source', w: '18%' },
    { label: 'Amount', w: '15%', align: 'right' },
    { label: 'Status', w: '13%' },
  ];
  const rows = d.dues.entries.map((e) => [
    e.dateYMD,
    e.kind === 'DUE' ? 'Due' : 'Payment',
    e.item || (e.kind === 'PAYMENT' ? 'Payment received' : '—'),
    e.source || '—',
    money(e.amount),
    e.kind === 'DUE' ? (e.status === 'PAID' ? 'Paid' : e.status === 'PARTIAL' ? 'Partial' : 'Pending') : 'Credit',
  ]);
  return E(
    View,
    { key: 'dues' },
    sectionTitle('Dues ledger', accent),
    E(View, { style: styles.statRow }, ...stats),
    rows.length ? table(headers, rows) : E(Text, { style: styles.empty }, 'No dues activity in this period.'),
  );
}

const SELF_SECTIONS = {
  attendance: selfAttendanceSection,
  tasks: selfTasksSection,
  leaves: selfLeavesSection,
  dues: selfDuesSection,
};
const SELF_ORDER = ['attendance', 'tasks', 'leaves', 'dues'];

function buildSelfDoc(data, sections, logo) {
  const accent = data.company.brandColor || DEFAULT_ACCENT;
  const typeLabel = `${data.type.charAt(0).toUpperCase()}${data.type.slice(1)} personal report`;
  const body = SELF_ORDER.filter((s) => sections.includes(s)).map((s) => SELF_SECTIONS[s](data, accent));
  return E(
    Document,
    {},
    E(
      Page,
      { size: 'A4', style: styles.page, wrap: true },
      header(data, logo, accent, typeLabel),
      metaLine(data),
      selfSubject(data),
      ...body,
      footer(data, typeLabel),
    ),
  );
}

export async function renderReportToStream(data, sections, logo = null) {
  return renderToStream(buildCompanyDoc(data, sections, logo));
}

export async function renderSelfReportToStream(data, sections, logo = null) {
  return renderToStream(buildSelfDoc(data, sections, logo));
}

/* ── Per-employee leave ledger ───────────────────────────── */
const LEAVE_STATUS_COLOR = { APPROVED: '#16a34a', PENDING: '#d97706', REJECTED: '#dc2626', CANCELLED: '#9ca3af' };
const tc = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '—'); // CASUAL -> Casual
function dmon(ymd) {
  if (!ymd) return '—';
  const d = new Date(`${ymd}T00:00:00Z`);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mon = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${dd} ${mon} ${d.getUTCFullYear()}`;
}

function ledgerSubject(d) {
  const s = d.subject;
  return E(
    View,
    { style: styles.subjectCard },
    E(View, { style: styles.subjectItem }, E(Text, { style: styles.subjectLabel }, 'Employee'), E(Text, { style: styles.subjectValue }, s.name)),
    E(View, { style: styles.subjectItem }, E(Text, { style: styles.subjectLabel }, 'Employee ID'), E(Text, { style: styles.subjectValue }, s.employeeId || '—')),
    E(View, { style: styles.subjectItem }, E(Text, { style: styles.subjectLabel }, 'Role'), E(Text, { style: styles.subjectValue }, s.roleLabel || cap(s.role))),
    E(View, { style: styles.subjectItem }, E(Text, { style: styles.subjectLabel }, 'Leave year'), E(Text, { style: styles.subjectValue }, d.period.label)),
  );
}

function buildLeaveLedgerDoc(data, logo) {
  const accent = data.company.brandColor || DEFAULT_ACCENT;
  const label = 'Leave ledger';
  const b = data.balance;
  const stats = [
    stat('Quota', b.totalQuota, 'l1'),
    stat('Used', b.used, 'l2'),
    stat('Remaining', b.remaining, 'l3'),
    stat('Overtime banked', dur(b.overtimeMinutes || 0), 'l4'),
  ];
  const byType = Object.entries(data.byType || {});
  const headers = [
    { label: 'Dates', w: '27%' },
    { label: 'Type', w: '13%' },
    { label: 'Days', w: '9%', align: 'right' },
    { label: 'Status', w: '13%' },
    { label: 'Applied', w: '13%' },
    { label: 'Reason', w: '25%' },
  ];
  const rows = data.leaves.map((l) => [
    l.startYMD === l.endYMD ? `${dmon(l.startYMD)}${l.halfDay ? ' (half)' : ''}` : `${dmon(l.startYMD)} → ${dmon(l.endYMD)}`,
    tc(l.type),
    String(l.days),
    { text: tc(l.status), color: LEAVE_STATUS_COLOR[l.status] },
    l.appliedYMD ? dmon(l.appliedYMD) : '—',
    l.reason || '—',
  ]);
  return E(
    Document,
    {},
    E(
      Page,
      { size: 'A4', style: styles.page, wrap: true },
      header(data, logo, accent, label),
      metaLine(data),
      ledgerSubject(data),
      sectionTitle('Balance', accent),
      E(View, { style: styles.statRow }, ...stats),
      byType.length ? E(Text, { style: styles.empty }, `Taken by type — ${byType.map(([t, n]) => `${tc(t)}: ${n}`).join('   ·   ')}`) : null,
      sectionTitle('Leaves this year', accent),
      rows.length ? table(headers, rows) : E(Text, { style: styles.empty }, 'No leave requests this year.'),
      footer(data, label),
    ),
  );
}

export async function renderLeaveLedgerToStream(data, logo = null) {
  return renderToStream(buildLeaveLedgerDoc(data, logo));
}
