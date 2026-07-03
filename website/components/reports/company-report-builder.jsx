'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Download, FileText } from 'lucide-react';
import { api, downloadFile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { GlassPanel } from '@/components/glass/glass-panel';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ReportPreview } from '@/components/reports/report-preview';
import { PeriodPicker } from '@/components/reports/period-picker';
import { REPORT_SECTIONS } from '@/lib/report';
import { todayYMD } from '@/lib/expense';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function CompanyReportBuilder() {
  const [type, setType] = React.useState('daily'); // opens on today's report
  const [date, setDate] = React.useState(todayYMD());
  const [sections, setSections] = React.useState(null); // null until allowed sections load
  const [downloading, setDownloading] = React.useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['company-report', type, date],
    queryFn: () => api.get(`/reports/${type}/preview?date=${date}`),
  });

  const allowed = data?.allowedSections ?? [];
  const visibleSections = REPORT_SECTIONS.filter((s) => allowed.includes(s.value));

  // Default selection to everything allowed; drop anything no longer permitted.
  React.useEffect(() => {
    if (!allowed.length) return;
    setSections((prev) => (prev === null ? allowed : prev.filter((s) => allowed.includes(s))));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = sections ?? allowed;
  const toggleSection = (s) => setSections((prev) => {
    const base = prev ?? allowed;
    return base.includes(s) ? base.filter((x) => x !== s) : [...base, s];
  });

  const download = async () => {
    if (!selected.length) return toast.error('Pick at least one section');
    setDownloading(true);
    try {
      const url = `${API_BASE}/api/reports/${type}?date=${date}&sections=${selected.join(',')}`;
      await downloadFile(url, `${type}-report-${date}.pdf`);
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
          <Building2 className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold tracking-tight">Company reports</h2>
          <p className="text-sm text-muted-foreground">Organisation-wide figures across the team — only sections you can access are shown.</p>
        </div>
      </div>

      <GlassPanel className="p-5">
        <div className="flex flex-wrap items-end gap-4">
          <PeriodPicker idPrefix="cr" type={type} onTypeChange={setType} date={date} onDateChange={setDate} />
          <div className="w-full space-y-1.5 sm:w-auto">
            <Label>Sections</Label>
            <div className="flex flex-wrap gap-1.5">
              {visibleSections.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => toggleSection(s.value)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors',
                    selected.includes(s.value)
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
            <Button onClick={download} disabled={downloading || !selected.length} className="h-10 w-full sm:w-auto">
              <Download className="size-4" /> {downloading ? 'Generating…' : 'Download PDF'}
            </Button>
          </div>
        </div>
        {data ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Period: {data.period.label} ({data.period.from} → {data.period.to})
          </p>
        ) : null}
      </GlassPanel>

      {isLoading ? (
        <LoadingState label="Aggregating report…" />
      ) : isError ? (
        <EmptyState icon={FileText} title="Couldn't load the report" description="Please try again." />
      ) : data ? (
        <ReportPreview data={data} sections={selected} />
      ) : null}
    </div>
  );
}
