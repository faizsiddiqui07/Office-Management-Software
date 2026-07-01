import { createElement as E } from 'react';
import { Document, Page, View, Text, Image, StyleSheet, renderToStream } from '@react-pdf/renderer';

const DEFAULT_ACCENT = '#E5342B';
const HEADER_BG = '#1B1F2A';
const INK = '#1f2430';
const MUTE = '#6b7280';
const HAIR = '#e5e7eb';

const styles = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 46, paddingHorizontal: 34, fontSize: 8.5, color: INK, fontFamily: 'Helvetica' },
  band: { backgroundColor: HEADER_BG, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logo: { height: 30, width: 150, objectFit: 'contain', objectPositionX: 0 },
  bandCompany: { color: '#ffffff', fontSize: 15, fontFamily: 'Helvetica-Bold' },
  bandRight: { alignItems: 'flex-end' },
  bandTitle: { color: '#ffffff', fontSize: 12, fontFamily: 'Helvetica-Bold' },
  bandSub: { color: '#c7cbd4', fontSize: 8, marginTop: 2 },
  accentBar: { height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, marginBottom: 10, marginTop: -1 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  meta: { fontSize: 8, color: MUTE },
  statRow: { flexDirection: 'row', marginBottom: 10 },
  stat: { width: '25%' },
  statLabel: { fontSize: 7, color: MUTE, textTransform: 'uppercase' },
  statValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginTop: 1 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#eef0f3', paddingVertical: 4 },
  trHeader: { borderBottomWidth: 1, borderBottomColor: '#cbd0d8' },
  trAlt: { backgroundColor: '#fafbfc' },
  td: { paddingRight: 6 },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 7, color: MUTE, textTransform: 'uppercase' },
  empty: { fontSize: 9, color: '#9ca3af', marginTop: 12, textAlign: 'center' },
  footer: {
    position: 'absolute', bottom: 20, left: 34, right: 34,
    flexDirection: 'row', justifyContent: 'space-between',
    fontSize: 7, color: '#9ca3af', borderTopWidth: 0.5, borderTopColor: HAIR, paddingTop: 6,
  },
});

const COLS = [
  { key: 'title', label: 'Task', w: '31%' },
  { key: 'owner', label: 'Owner', w: '15%' },
  { key: 'assignedBy', label: 'Assigned by', w: '14%' },
  { key: 'status', label: 'Status', w: '9%' },
  { key: 'dueYMD', label: 'Due', w: '11%' },
  { key: 'created', label: 'Created', w: '10%' },
  { key: 'completed', label: 'Completed', w: '10%' },
];

function fmtDate(d) {
  if (!d) return '';
  return String(d).slice(0, 10);
}

function row(cells, key, opts = {}) {
  const { header, alt } = opts;
  return E(
    View,
    { key, style: [styles.tr, header ? styles.trHeader : null, alt ? styles.trAlt : null], wrap: false },
    COLS.map((c, i) =>
      E(Text, { key: i, style: [styles.td, { width: c.w }, header ? styles.th : null] }, String(cells[i] ?? '')),
    ),
  );
}

function buildDoc(data, logo) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(data.company?.brandColor || '') ? data.company.brandColor : DEFAULT_ACCENT;
  const tasks = data.tasks || [];
  const done = tasks.filter((t) => t.status === 'DONE').length;
  const pending = tasks.length - done;

  const head = row(COLS.map((c) => c.label), 'head', { header: true });
  const body = tasks.map((t, i) =>
    row(
      [
        t.title,
        t.owner?.name || '',
        t.assignedBy?.name || '—',
        t.status === 'DONE' ? 'Done' : 'Pending',
        t.dueYMD || '',
        fmtDate(t.createdAt),
        fmtDate(t.completedAt),
      ],
      String(i),
      { alt: i % 2 === 1 },
    ),
  );

  const header = E(
    View,
    { key: 'h' },
    E(
      View,
      { style: styles.band },
      logo ? E(Image, { style: styles.logo, src: logo.dataUri }) : E(Text, { style: styles.bandCompany }, data.company?.name || 'Company'),
      E(
        View,
        { style: styles.bandRight },
        E(Text, { style: styles.bandTitle }, `Tasks — ${data.scopeLabel || 'All'}`),
        E(Text, { style: styles.bandSub }, data.for ? `For ${data.for}` : ''),
      ),
    ),
    E(View, { style: [styles.accentBar, { backgroundColor: accent }] }),
    E(
      View,
      { style: styles.statRow },
      E(View, { style: styles.stat }, E(Text, { style: styles.statLabel }, 'Total'), E(Text, { style: styles.statValue }, String(tasks.length))),
      E(View, { style: styles.stat }, E(Text, { style: styles.statLabel }, 'Pending'), E(Text, { style: styles.statValue }, String(pending))),
      E(View, { style: styles.stat }, E(Text, { style: styles.statLabel }, 'Completed'), E(Text, { style: styles.statValue }, String(done))),
      E(View, { style: styles.stat }, E(Text, { style: styles.statLabel }, 'Generated'), E(Text, { style: [styles.statValue, { fontSize: 10 }] }, data.generatedAt || '')),
    ),
  );

  const table = tasks.length
    ? E(View, { key: 't' }, head, ...body)
    : E(Text, { key: 'e', style: styles.empty }, 'No tasks for this selection.');

  const footer = E(
    View,
    { key: 'f', fixed: true, style: styles.footer },
    E(Text, {}, `${data.company?.name || ''} · Task report`),
    E(Text, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` }),
  );

  return E(Document, {}, E(Page, { size: 'A4', style: styles.page }, header, table, footer));
}

export async function renderTasksPdf(data, logo = null) {
  return renderToStream(buildDoc(data, logo));
}
