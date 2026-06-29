'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { GlassPanel } from '@/components/glass/glass-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { REPORT_TYPES, SELF_REPORT_SECTIONS } from '@/lib/report';
import { todayYMD, formatMoney } from '@/lib/expense';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

function Mini({ label, value, hint }) {
  return (
    <div className="rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tracking-tight">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function MyReportCard() {
  const [type, setType] = React.useState('monthly');
  const [date, setDate] = React.useState(todayYMD());
  const [sections, setSections] = React.useState(['attendance', 'leaves', 'dues']);
  const [downloading, setDownloading] = React.useState(false);

  const { data } = useQuery({
    queryKey: ['self-report', type, date],
    queryFn: () => api.get(`/reports/me/preview?type=${type}&date=${date}`),
  });

  const toggle = (s) => setSections((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const download = async () => {
    if (!sections.length) return toast.error('Pick at least one section');
    setDownloading(true);
    try {
      const url = `${API_BASE}/api/reports/me?type=${type}&date=${date}&sections=${sections.join(',')}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Could not generate the report');
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `my-${type}-report-${date}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      toast.success('Report downloaded');
    } catch (e) {
      toast.error(e?.message || 'Could not download');
    } finally {
      setDownloading(false);
    }
  };

  const t = data?.attendance?.totals;
  const bal = data?.leaves?.balance;
  const dues = data?.dues;
  const duesValue = dues ? (dues.pending > 0 ? `${formatMoney(dues.pending)} due` : dues.advance > 0 ? `${formatMoney(dues.advance)} advance` : 'Settled') : '—';

  return (
    <GlassPanel className="space-y-5 p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <FileText className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold tracking-tight">My report</h2>
          <p className="text-sm text-muted-foreground">Your own attendance, leave & dues — a detailed, branded PDF.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label htmlFor="mr-type">Period</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="mr-type" className="w-full bg-background/50 sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORT_TYPES.map((x) => (
                <SelectItem key={x.value} value={x.value}>
                  {x.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label htmlFor="mr-date">Date in period</Label>
          <Input id="mr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-background/50 sm:w-44" />
        </div>
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label>Include</Label>
          <div className="flex flex-wrap gap-1.5">
            {SELF_REPORT_SECTIONS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => toggle(s.value)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors',
                  sections.includes(s.value)
                    ? 'bg-primary/12 text-primary ring-primary/25'
                    : 'bg-muted/40 text-muted-foreground ring-border hover:text-foreground',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="w-full sm:ml-auto sm:w-auto">
          <Button onClick={download} disabled={downloading} className="h-10 w-full sm:w-auto">
            <Download className="size-4" /> {downloading ? 'Generating…' : 'Download my report'}
          </Button>
        </div>
      </div>

      {data ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Mini label="Attendance" value={`${t.attendanceRate}%`} hint={`${t.present} present · ${t.late} late · ${t.absent} absent`} />
          <Mini label="Leave balance" value={`${bal.remaining} left`} hint={`${bal.used} used of ${bal.total}`} />
          <Mini label="Dues" value={duesValue} hint={data.period.label} />
        </div>
      ) : null}
    </GlassPanel>
  );
}
