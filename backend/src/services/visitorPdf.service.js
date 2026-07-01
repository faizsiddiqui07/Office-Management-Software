import { createElement as E } from 'react';
import { Document, Page, View, Text, Image, StyleSheet, renderToStream } from '@react-pdf/renderer';

const DEFAULT_ACCENT = '#E5342B';
const HEADER_BG = '#1B1F2A';
const INK = '#1f2430';
const MUTE = '#6b7280';
const HAIR = '#e5e7eb';

const styles = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 46, paddingHorizontal: 30, fontSize: 8, color: INK, fontFamily: 'Helvetica' },
  band: { backgroundColor: HEADER_BG, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logo: { height: 30, width: 150, objectFit: 'contain', objectPositionX: 0 },
  bandCompany: { color: '#ffffff', fontSize: 15, fontFamily: 'Helvetica-Bold' },
  bandRight: { alignItems: 'flex-end' },
  bandTitle: { color: '#ffffff', fontSize: 12, fontFamily: 'Helvetica-Bold' },
  bandSub: { color: '#c7cbd4', fontSize: 8, marginTop: 2 },
  accentBar: { height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, marginBottom: 10, marginTop: -1 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  meta: { fontSize: 8, color: MUTE },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#eef0f3', paddingVertical: 4 },
  trHeader: { borderBottomWidth: 1, borderBottomColor: '#cbd0d8' },
  trAlt: { backgroundColor: '#fafbfc' },
  td: { paddingRight: 5 },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 7, color: MUTE, textTransform: 'uppercase' },
  empty: { fontSize: 9, color: '#9ca3af', marginTop: 12, textAlign: 'center' },
  footer: {
    position: 'absolute', bottom: 20, left: 30, right: 30,
    flexDirection: 'row', justifyContent: 'space-between',
    fontSize: 7, color: '#9ca3af', borderTopWidth: 0.5, borderTopColor: HAIR, paddingTop: 6,
  },
});

const COLS = [
  { key: 'dateYMD', label: 'Date', w: '9%' },
  { key: 'name', label: 'Name', w: '13%' },
  { key: 'phone', label: 'Phone', w: '10%' },
  { key: 'category', label: 'Category', w: '9%' },
  { key: 'fromPlace', label: 'From', w: '12%' },
  { key: 'company', label: 'Who / Company', w: '14%' },
  { key: 'toMeet', label: 'To meet', w: '12%' },
  { key: 'checkInTime', label: 'In', w: '6%' },
  { key: 'checkOutTime', label: 'Out', w: '6%' },
  { key: 'purpose', label: 'Purpose', w: '9%' },
];

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
  const visitors = data.visitors || [];

  const head = row(COLS.map((c) => c.label), 'head', { header: true });
  const body = visitors.map((v, i) =>
    row(
      [v.dateYMD, v.name, v.phone, v.category, v.fromPlace, v.company, v.toMeet, v.checkInTime, v.checkOutTime, v.purpose],
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
        E(Text, { style: styles.bandTitle }, 'Visitor register'),
        E(Text, { style: styles.bandSub }, data.period?.label || ''),
      ),
    ),
    E(View, { style: [styles.accentBar, { backgroundColor: accent }] }),
    E(
      View,
      { style: styles.metaRow },
      E(Text, { style: styles.meta }, `${data.company?.name || ''}`),
      E(Text, { style: styles.meta }, `${visitors.length} ${visitors.length === 1 ? 'entry' : 'entries'} · Generated ${data.generatedAt || ''}`),
    ),
  );

  const table = visitors.length
    ? E(View, { key: 't' }, head, ...body)
    : E(Text, { key: 'e', style: styles.empty }, 'No visitor entries for this period.');

  const footer = E(
    View,
    { key: 'f', fixed: true, style: styles.footer },
    E(Text, {}, `${data.company?.name || ''} · Visitor register`),
    E(Text, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` }),
  );

  return E(
    Document,
    {},
    E(Page, { size: 'A4', orientation: 'landscape', style: styles.page }, header, table, footer),
  );
}

export async function renderVisitorsPdf(data, logo = null) {
  return renderToStream(buildDoc(data, logo));
}
