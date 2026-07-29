'use client';

import { FileText, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/glass/page-header';
import { EmptyState } from '@/components/glass/empty-state';
import { MyReportCard } from '@/components/reports/my-report-card';
import { CompanyReportBuilder } from '@/components/reports/company-report-builder';

export default function ReportsPage() {
  const { user } = useAuth();
  // The reports module is gated on "View / download reports" — matches the server, so
  // revoking that permission actually hides reports instead of doing nothing.
  const canReports = !!user && can(user, 'downloadReports');
  // Company report = leadership who can see everyone's data (CEO & President and
  // Executive Management). Everyone else sees only their own report below.
  const canCompany = !!user && can(user, 'leadershipDashboard') && can(user, 'viewEveryone');

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Reports"
        title="Reports"
        icon={FileText}
        description="Generate detailed, branded PDF reports — your own records, or company-wide if you have access."
      />

      {!canReports ? (
        <EmptyState icon={ShieldAlert} title="No access" description="You don’t have permission to view or download reports." />
      ) : (
        <>
      <MyReportCard />

      {canCompany ? (
        <>
          <div className="border-t border-border/50" />
          <CompanyReportBuilder />
        </>
      ) : null}
        </>
      )}
    </div>
  );
}
