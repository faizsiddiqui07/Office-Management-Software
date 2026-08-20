import { createElement as E } from 'react';
import { Document, Page, View, Text, Image, StyleSheet, renderToStream } from '@react-pdf/renderer';

// A small, printable visitor pass — one card per visitor. Shares the register PDF's brand
// language (dark band + accent bar) so a printed pass and the register look like one system.
const DEFAULT_ACCENT = '#E5342B';
const HEADER_BG = '#1B1F2A';
const INK = '#1f2430';
const MUTE = '#6b7280';
const HAIR = '#e5e7eb';

const styles = StyleSheet.create({
  page: { padding: 22, fontSize: 10, color: INK, fontFamily: 'Helvetica' },
  band: { backgroundColor: HEADER_BG, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logo: { height: 26, width: 120, objectFit: 'contain', objectPositionX: 0 },
  bandCompany: { color: '#ffffff', fontSize: 13, fontFamily: 'Helvetica-Bold' },
  bandTitle: { color: '#ffffff', fontSize: 11, fontFamily: 'Helvetica-Bold' },
  accentBar: { height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, marginTop: -1, marginBottom: 14 },

  passLabel: { fontSize: 8, color: MUTE, textTransform: 'uppercase', letterSpacing: 1 },
  passNo: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: INK, marginTop: 1 },
  name: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: INK, marginTop: 12 },
  company: { fontSize: 11, color: MUTE, marginTop: 2 },

  rows: { marginTop: 16, borderTopWidth: 0.5, borderTopColor: HAIR },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: HAIR },
  rowLabel: { fontSize: 9, color: MUTE, textTransform: 'uppercase' },
  rowValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: INK, maxWidth: '62%', textAlign: 'right' },

  note: { marginTop: 16, fontSize: 8, color: '#9ca3af' },
});

function detailRow(label, value, key) {
  return E(
    View,
    { key, style: styles.row },
    E(Text, { style: styles.rowLabel }, label),
    E(Text, { style: styles.rowValue }, String(value || '—')),
  );
}

function buildPassDoc(data, logo) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(data.company?.brandColor || '') ? data.company.brandColor : DEFAULT_ACCENT;
  const v = data.visitor || {};
  const rows = [
    detailRow('Visiting', v.toMeet || v.company || '—', 'r1'),
    v.category ? detailRow('Category', v.category, 'r2') : null,
    detailRow('Date', v.dateYMD || data.generatedAt || '—', 'r3'),
    v.checkInTime ? detailRow('Checked in', v.checkInTime, 'r4') : null,
    v.fromPlace ? detailRow('From', v.fromPlace, 'r5') : null,
  ].filter(Boolean);

  return E(
    Document,
    {},
    E(
      // A6 portrait — a neat half-of-half sheet for a lanyard/clip pass.
      Page,
      { size: 'A6', style: styles.page },
      E(
        View,
        { style: styles.band },
        logo ? E(Image, { style: styles.logo, src: logo.dataUri }) : E(Text, { style: styles.bandCompany }, data.company?.name || 'Company'),
        E(Text, { style: styles.bandTitle }, 'Visitor pass'),
      ),
      E(View, { style: [styles.accentBar, { backgroundColor: accent }] }),
      E(Text, { style: styles.passLabel }, 'Pass no.'),
      E(Text, { style: styles.passNo }, data.passNo || '—'),
      E(Text, { style: styles.name }, v.name || 'Visitor'),
      v.company ? E(Text, { style: styles.company }, v.company) : null,
      E(View, { style: styles.rows }, ...rows),
      E(Text, { style: styles.note }, `${data.company?.name || 'Reception'} · Please wear this pass and return it on the way out.`),
    ),
  );
}

export async function renderVisitorPassPdf(data, logo = null) {
  return renderToStream(buildPassDoc(data, logo));
}
