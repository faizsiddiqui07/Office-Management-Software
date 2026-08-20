'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, UserSearch } from 'lucide-react';
import { api, downloadFile } from '@/lib/api';
import { GlassPanel } from '@/components/glass/glass-panel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DateRange } from '@/components/ui/date-range';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { companyTodayYMD } from '@/lib/expense';
import { APP_LIVE_YMD } from '@/lib/app-live';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * RP4: pull ONE person's own report — for an appraisal, or a clean handover when someone
 * leaves. The per-user PDF endpoint (`/users/:id/report.pdf?from=&to=`) already existed and
 * was only reachable from a person's profile; this brings it onto the Reports page, where
 * you go to generate reports. Gated on `viewEveryone` (the same permission the endpoint
 * checks), so an Admin Manager who can't pull the whole company can still pull one person's.
 */
export function PersonReportCard() {
  const monthStart = `${companyTodayYMD().slice(0, 7)}-01`;
  const [userId, setUserId] = React.useState('');
  const [range, setRange] = React.useState({ from: monthStart, to: companyTodayYMD() });
  const [downloading, setDownloading] = React.useState(false);

  const { data } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users') });
  const people = React.useMemo(
    () => (data?.users ?? [])
      .filter((u) => u.isActive !== false)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [data],
  );
  const selected = people.find((u) => (u.id || u._id) === userId);

  const download = async () => {
    if (!userId) return toast.error('Pick a person');
    if (!range.from || !range.to) return toast.error('Pick a start and end date');
    setDownloading(true);
    try {
      const url = `${API_BASE}/api/users/${userId}/report.pdf?from=${range.from}&to=${range.to}`;
      const who = (selected?.name || 'report').replace(/\s+/g, '-').toLowerCase();
      await downloadFile(url, `report-${who}-${range.from}_to_${range.to}.pdf`);
      toast.success('Report downloaded');
    } catch (e) {
      toast.error(e?.message || 'Could not download');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <UserSearch className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold tracking-tight">Someone’s report</h2>
          <p className="text-sm text-muted-foreground">One person’s own attendance, tasks & leave for a date range — for an appraisal or a handover.</p>
        </div>
      </div>

      <GlassPanel className="p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-full space-y-1.5 sm:w-64">
            <Label>Person</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="bg-background/50">
                <SelectValue placeholder="Pick a person" />
              </SelectTrigger>
              <SelectContent>
                {people.map((u) => (
                  <SelectItem key={u.id || u._id} value={u.id || u._id}>
                    {u.name}{u.employeeId ? ` · ${u.employeeId}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full space-y-1.5 sm:w-auto">
            <Label>Date range</Label>
            <DateRange value={range} onChange={setRange} min={APP_LIVE_YMD} max={companyTodayYMD()} />
          </div>
          <div className="w-full sm:ml-auto sm:w-auto">
            <Button onClick={download} disabled={downloading || !userId} className="h-10 w-full sm:w-auto">
              <Download className="size-4" /> {downloading ? 'Generating…' : 'Download their report'}
            </Button>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
