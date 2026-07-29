'use client';

import * as React from 'react';
import { CalendarDays, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { downloadFile } from '@/lib/api';
import { PageHeader } from '@/components/glass/page-header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BalanceCards } from '@/components/leaves/balance-cards';
import { ApplyLeaveDialog } from '@/components/leaves/apply-leave-dialog';
import { LeaveHistory } from '@/components/leaves/leave-history';
import { RequestsQueue } from '@/components/leaves/requests-queue';

function MyLeaves() {
  const [busy, setBusy] = React.useState(false);
  const downloadLedger = async () => {
    setBusy(true);
    try {
      const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
      await downloadFile(`${base}/api/leaves/ledger.pdf`, 'my-leave-ledger.pdf');
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
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={downloadLedger} disabled={busy}>
            <Download className="size-4" /> {busy ? 'Generating…' : 'Ledger (PDF)'}
          </Button>
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

  const description = canApply
    ? 'Apply for leave and track your balance — your yearly quota (Apr–Mar) is deducted automatically on approval.'
    : 'Review and approve your team’s leave requests.';

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Leaves" title="Leave management" icon={CalendarDays} description={description} />

      {canApply && isApprover ? (
        <Tabs defaultValue="me">
          <TabsList>
            <TabsTrigger value="me">My leaves</TabsTrigger>
            <TabsTrigger value="queue">Requests</TabsTrigger>
          </TabsList>
          <TabsContent value="me" className="pt-6">
            <MyLeaves />
          </TabsContent>
          <TabsContent value="queue" className="pt-6">
            <RequestsQueue />
          </TabsContent>
        </Tabs>
      ) : isApprover ? (
        <RequestsQueue />
      ) : (
        <MyLeaves />
      )}
    </div>
  );
}
