'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { downloadFile } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const APP_LIVE_YEAR = 2026;
// What each "include" choice maps to on the API. Public holidays are always in.
const INCLUDE = {
  optional: { label: 'Holidays + optional', optional: true, events: false },
  holidays: { label: 'Holidays only', optional: false, events: false },
  all: { label: 'Everything (incl. events)', optional: true, events: true },
};

/**
 * Downloads the printable annual holiday list (a branded one-page PDF for the notice
 * board). Pick a calendar year and how much to include; public holidays are always
 * listed, optional holidays by default, events on request. Uses the app's one iOS-safe
 * Bearer download path (downloadFile), same as the leave ledger.
 */
export function HolidayListDownload() {
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear + 1; y >= APP_LIVE_YEAR; y -= 1) years.push(y);

  const [year, setYear] = React.useState(String(thisYear));
  const [inc, setInc] = React.useState('optional');
  const [busy, setBusy] = React.useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
      const { optional, events } = INCLUDE[inc];
      await downloadFile(
        `${base}/api/holidays/list.pdf?year=${year}&optional=${optional}&events=${events}`,
        `holiday-list-${year}.pdf`,
      );
      toast.success('Holiday list downloaded');
    } catch (e) {
      toast.error(e?.message || 'Could not download the holiday list');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={year} onValueChange={setYear}>
        <SelectTrigger size="sm" className="w-[92px] bg-background/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={inc} onValueChange={setInc}>
        <SelectTrigger size="sm" className="w-[190px] bg-background/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(INCLUDE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={download} disabled={busy}>
        <Download className="size-4" /> {busy ? 'Generating…' : 'Download list (PDF)'}
      </Button>
    </div>
  );
}
