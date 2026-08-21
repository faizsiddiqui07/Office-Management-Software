'use client';

import * as React from 'react';
import { CalendarDays, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { downloadFile, API_BASE_URL } from '@/lib/api';
import { PageHeader } from '@/components/glass/page-header';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { companyTodayYMD } from '@/lib/expense';
import { APP_LIVE_YMD } from '@/lib/app-live';
import { BalanceCards } from '@/components/leaves/balance-cards';
import { ApplyLeaveDialog } from '@/components/leaves/apply-leave-dialog';
import { LeaveHistory } from '@/components/leaves/leave-history';
import { RequestsQueue } from '@/components/leaves/requests-queue';
import { DeclareWfhDialog } from '@/components/leaves/declare-wfh-dialog';

// Leave years run on the fiscal calendar (Apr 1 – Mar 31); the "year" key is the STARTING
// calendar year. Mirrors backend/src/lib/leaveYear.js so the picker and the PDF agree.
function leaveYearOf(ymd) {
  const y = Number(ymd.slice(0, 4));
  return Number(ymd.slice(5, 7)) >= 4 ? y : y - 1;
}
function fiscalYearLabel(y) {
  return `${y}–${String(y + 1).slice(2)}`; // e.g. 2026–27
}

function MyLeaves({ canWFH }) {
  const [busy, setBusy] = React.useState(false);
  // Every fiscal leave year that can hold data: from go-live up to now, newest first.
  // Before the first year rolls over there is only one — then the picker stays hidden and
  // the button behaves exactly as it always did.
  const years = React.useMemo(() => {
    const first = leaveYearOf(APP_LIVE_YMD);
    const current = leaveYearOf(companyTodayYMD());
    const out = [];
    for (let y = current; y >= first; y -= 1) out.push(y);
    return out;
  }, []);
  const [year, setYear] = React.useState(years[0]);

  const downloadLedger = async () => {
    setBusy(true);
    try {
      const base = API_BASE_URL;
      await downloadFile(`${base}/api/leaves/ledger.pdf?year=${year}`, `my-leave-ledger-${year}-${String(year + 1).slice(2)}.pdf`);
      toast.success('Leave ledger downloaded');
    } catch (e) {
      toast.error(e?.message || 'Could not download the ledger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <BalanceCards />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">My requests</h2>
        <div className="flex flex-wrap items-center gap-2">
          {/* Pick which fiscal year's ledger to pull — only shown once more than one exists. */}
          {years.length > 1 ? (
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-36 bg-background/50" aria-label="Leave year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{fiscalYearLabel(y)} (Apr–Mar)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button variant="outline" onClick={downloadLedger} disabled={busy}>
            <Download className="size-4" /> {busy ? 'Generating…' : 'Ledger (PDF)'}
          </Button>
          {/* Work from home is its own request — one day, no balance, 2 a year. */}
          {canWFH ? <ApplyLeaveDialog wfh /> : null}
          <ApplyLeaveDialog />
        </div>
      </div>
      <LeaveHistory />
    </div>
  );
}

export default function LeavesPage() {
  const { user } = useAuth();
  const canApply = !!user && can(user, 'applyLeave');
  const isApprover = !!user && can(user, 'approveLeave');
  // Work from home belongs to people who track their own attendance.
  const canWFH = !!user && can(user, 'markAttendance');
  // Declaring a WFH day for the whole office is the owners' call. The server tells us
  // who is in that tier (it resolves it by rank, so a role rename can't break it); this
  // only hides the button — the route checks again.
  const isOwner = !!user?.isOwner;

  const description = canApply
    ? 'Apply for leave or a work-from-home day, and track your balance — your yearly leave quota (Apr–Mar) is deducted automatically on approval.'
    : 'Review and approve your team’s leave and work-from-home requests.';

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader eyebrow="Leaves" title="Leave management" icon={CalendarDays} description={description} />
        {isOwner ? <DeclareWfhDialog /> : null}
      </div>

      {canApply && isApprover ? (
        <Tabs defaultValue="me">
          <TabsList>
            <TabsTrigger value="me">My leaves</TabsTrigger>
            <TabsTrigger value="queue">Requests</TabsTrigger>
          </TabsList>
          <TabsContent value="me" className="pt-6">
            <MyLeaves canWFH={canWFH} />
          </TabsContent>
          <TabsContent value="queue" className="pt-6">
            <RequestsQueue />
          </TabsContent>
        </Tabs>
      ) : isApprover ? (
        <RequestsQueue />
      ) : (
        <MyLeaves canWFH={canWFH} />
      )}
    </div>
  );
}
