'use client';

import { Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/glass/page-header';
import { EmptyState } from '@/components/glass/empty-state';
import { ExpenseSummary } from '@/components/expenses/expense-summary';
import { ExpenseCharts } from '@/components/expenses/expense-charts';
import { ExpenseTable } from '@/components/expenses/expense-table';

export default function ExpensesPage() {
  const { user } = useAuth();
  const canView = !!user && can(user, 'viewExpenses');
  const canManage = !!user && can(user, 'manageExpenses');

  if (!canView) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Finance" title="Expenses" icon={Wallet} />
        <EmptyState icon={Wallet} title="No access" description="You don’t have access to the expense register." />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Finance"
        title="Expenses"
        icon={Wallet}
        description={
          canManage
            ? 'The office expense register — fast entry, live summaries, replacing the paper book.'
            : 'The office expense register — what the admin manager spends on supplies (read-only).'
        }
      />
      <ExpenseSummary />
      <ExpenseCharts />
      <ExpenseTable canManage={canManage} />
    </div>
  );
}
