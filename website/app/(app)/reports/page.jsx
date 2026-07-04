'use client';

import { FileText } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/glass/page-header';
import { MyReportCard } from '@/components/reports/my-report-card';
import { CompanyReportBuilder } from '@/components/reports/company-report-builder';

export default function ReportsPage() {
  const { user } = useAuth();
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

      <MyReportCard />

      {canCompany ? (
        <>
          <div className="border-t border-border/50" />
          <CompanyReportBuilder />
        </>
      ) : null}
    </div>
  );
}
