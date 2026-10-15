/**
 * lib/date-period.js ke do niyam jaanchta hai, jo poore app ki list filters par lagte hain:
 *
 *   1. Mahina matlab POORA mahina (1 se aakhri tak), "aaj tak" nahi.
 *   2. Leave/span us window me ginti hai agar uska KOI BHI din us window me pade.
 *
 * Browser me yeh dono dikh to jaate hain, par sirf AAJ ki taarikh par. Saal badalna
 * (Jan ka "last month" = Dec), leap year ka February, aur 3-mahine ka window saal ke
 * paar — in par haath se test karne ke liye system ki date badalni padti. Yahan asli
 * file hi padhi jaati hai aur uska ek hi import (companyYMD) badal diya jaata hai, to
 * jo chala wahi code hai jo app me jaata hai — uski nakal nahi.
 *
 *   node scripts/test-date-period.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'lib', 'date-period.js'), 'utf8').replace(/^import .*$/m, '');
const mod = await import(
  'data:text/javascript,' + encodeURIComponent('const companyYMD=()=>globalThis.__TODAY;' + src)
);

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

// ── Windows ────────────────────────────────────────────────────────────────────
for (const [today, preset, from, to] of [
  ['2026-10-15', 'this_month', '2026-10-01', '2026-10-31'],
  ['2026-10-15', 'last_month', '2026-09-01', '2026-09-30'],
  ['2026-10-15', 'last_3', '2026-08-01', '2026-10-31'],
  // Saal ka mod: January ka "pichhla mahina" December hai, pichhle saal ka.
  ['2027-01-07', 'last_month', '2026-12-01', '2026-12-31'],
  ['2027-01-07', 'last_3', '2026-11-01', '2027-01-31'],
  ['2026-12-31', 'this_month', '2026-12-01', '2026-12-31'],
  // February: leap year 29, warna 28.
  ['2028-03-10', 'last_month', '2028-02-01', '2028-02-29'],
  ['2027-03-10', 'last_month', '2027-02-01', '2027-02-28'],
]) {
  globalThis.__TODAY = today;
  check(`${today} ${preset}`, mod.resolvePeriod({ preset }), { from, to });
}

globalThis.__TODAY = '2026-10-15';
check('all time = no window', mod.resolvePeriod({ preset: 'all' }), { from: '', to: '' });
check('custom passes dates through', mod.resolvePeriod({ preset: 'custom', from: '2026-01-05', to: '2026-02-09' }), {
  from: '2026-01-05',
  to: '2026-02-09',
});

// ── Membership ─────────────────────────────────────────────────────────────────
const oct = { from: '2026-10-01', to: '2026-10-31' };
check('in window', mod.inPeriod('2026-10-15', oct), true);
check('before window', mod.inPeriod('2026-09-30', oct), false);
check('after window', mod.inPeriod('2026-11-01', oct), false);
check('first day', mod.inPeriod('2026-10-01', oct), true);
check('last day', mod.inPeriod('2026-10-31', oct), true);
check('no date is never in a window', mod.inPeriod('', oct), false);
check('open-ended from', mod.inPeriod('2027-05-01', { from: '2026-10-01', to: '' }), true);
check('open-ended to', mod.inPeriod('2020-01-01', { from: '', to: '2026-10-31' }), true);

// ── Overlap (leave spans) ──────────────────────────────────────────────────────
check('28 Sep → 3 Oct is in October', mod.overlapsPeriod('2026-09-28', '2026-10-03', oct), true);
check('28 Sep → 3 Oct is in September', mod.overlapsPeriod('2026-09-28', '2026-10-03', { from: '2026-09-01', to: '2026-09-30' }), true);
check('30 Oct → 4 Nov is in October', mod.overlapsPeriod('2026-10-30', '2026-11-04', oct), true);
check('wholly September is not', mod.overlapsPeriod('2026-09-01', '2026-09-30', oct), false);
check('wholly November is not', mod.overlapsPeriod('2026-11-01', '2026-11-02', oct), false);
check('one-day leave on the edge', mod.overlapsPeriod('2026-10-31', '2026-10-31', oct), true);
check('missing end falls back to start', mod.overlapsPeriod('2026-10-05', '', oct), true);

// ── Bookkeeping ────────────────────────────────────────────────────────────────
check('all-time is not "active"', mod.isPeriodActive({ from: '', to: '' }), false);
check('half a window is active', mod.isPeriodActive({ from: '2026-10-01', to: '' }), true);
check('describe both sides', mod.describePeriod(oct), '1 Oct 2026 – 31 Oct 2026');
check('describe open-ended', mod.describePeriod({ from: '2026-10-01', to: '' }), 'since 1 Oct 2026');

console.log(failed ? `\n${failed} FAILED\n` : '\nsab theek — all green\n');
process.exit(failed ? 1 : 0);
