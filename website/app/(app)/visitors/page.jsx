'use client';

import { DoorOpen } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/glass/page-header';
import { EmptyState } from '@/components/glass/empty-state';
import { VisitorTable } from '@/components/visitors/visitor-table';

export default function VisitorsPage() {
  const { user } = useAuth();
  const canAccess = !!user && can(user, 'manageVisitors');
  const canManageCategories = !!user && can(user, 'manageSettings');

  if (!canAccess) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Front desk" title="Visitors" icon={DoorOpen} />
        <EmptyState icon={DoorOpen} title="No access" description="You don’t have access to the visitor register." />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Front desk"
        title="Visitors"
        icon={DoorOpen}
        description="Log every visitor — who came, when, from where, and whom they met. Filter and export the full record."
      />
      <VisitorTable canManageCategories={canManageCategories} />
    </div>
  );
}
