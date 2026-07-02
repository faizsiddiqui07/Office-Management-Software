'use client';

import { CalendarDays } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/glass/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BalanceCards } from '@/components/leaves/balance-cards';
import { ApplyLeaveDialog } from '@/components/leaves/apply-leave-dialog';
import { LeaveHistory } from '@/components/leaves/leave-history';
import { RequestsQueue } from '@/components/leaves/requests-queue';

function MyLeaves() {
  return (
    <div className="space-y-6">
      <BalanceCards />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">My requests</h2>
        <ApplyLeaveDialog />
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
