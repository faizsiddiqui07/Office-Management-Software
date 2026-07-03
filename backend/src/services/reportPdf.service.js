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
  const generatedOn = new Date(data.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
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
function attendanceSection(d, accent) {
  const t = d.attendance.totals;
  const stats = [
    stat('Attendance rate', `${t.attendanceRate}%`, 's1'),
    stat('Working days', d.workingDays, 's2'),
    stat('Present', t.present, 's3'),
    stat('Came late', t.late, 's4'),
    stat('Absent', t.absent, 's5'),
    stat('On leave', t.onLeave, 's6'),
    stat('Worked hours', `${t.workedHours}h`, 's7'),
    stat('Overtime', dur(t.overtimeMinutes), 's8'),
  ];
  const headers = [
    { label: 'Employee', w: '26%' },
    { label: 'ID', w: '14%' },
    { label: 'Present', w: '10%', align: 'right' },
    { label: 'Late', w: '9%', align: 'right' },
    { label: 'Absent', w: '10%', align: 'right' },
    { label: 'Leave', w: '9%', align: 'right' },
    { label: 'Worked', w: '12%', align: 'right' },
    { label: 'OT', w: '10%', align: 'right' },
  ];
  const rows = d.attendance.perEmployee.map((e) => [e.name, e.employeeId, e.present, e.late, e.absent, e.onLeave, `${e.workedHours}h`, dur(e.overtimeMinutes)]);
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
    listRows.length ? E(Text, { style: styles.subTitle }, 'Expense list') : null,
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

function companyDuesSection(d, accent) {
  const headers = [
    { label: 'Person', w: '36%' },
    { label: 'ID', w: '16%' },
    { label: 'Role', w: '20%' },
    { label: 'Pending', w: '14%', align: 'right' },
    { label: 'Advance', w: '14%', align: 'right' },
  ];
  const rows = d.dues.people.map((p) => [
    p.name,
    p.employeeId,
    cap(p.role),
    { text: p.pending ? money(p.pending) : '—', color: p.pending ? STATUS_COLOR.ABSENT : undefined },
    p.advance ? money(p.advance) : '—',
  ]);
  return E(
    View,
    { key: 'dues' },
    sectionTitle('Dues ledger', accent),
    E(Text, { style: styles.muted }, `Outstanding: ${money(d.dues.totalPending)}  ·  Advances held: ${money(d.dues.totalAdvance)}  ·  ${d.dues.owingCount} owing`),
    rows.length ? table(headers, rows) : E(Text, { style: styles.empty }, 'Everyone is settled — no pending dues.'),
  );
}

const COMPANY_SECTIONS = {
  attendance: attendanceSection,
  leaves: leavesSection,
  expenses: expensesSection,
  roster: rosterSection,
  dues: companyDuesSection,
};
const COMPANY_ORDER = ['attendance', 'leaves', 'expenses', 'dues', 'roster'];

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
    E(View, { style: styles.subjectItem }, E(Text, { style: styles.subjectLabel }, 'Role'), E(Text, { style: styles.subjectValue }, cap(s.role))),
    E(View, { style: styles.subjectItem }, E(Text, { style: styles.subjectLabel }, 'Department'), E(Text, { style: styles.subjectValue }, s.department || '—')),
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
    stat('Worked hours', `${t.workedHours}h`, 's7'),
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
    day.workedHours ? `${day.workedHours}h` : '—',
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
  leaves: selfLeavesSection,
  dues: selfDuesSection,
};
const SELF_ORDER = ['attendance', 'leaves', 'dues'];

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
