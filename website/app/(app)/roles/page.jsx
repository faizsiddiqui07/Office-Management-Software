'use client';

import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/glass/page-header';
import { EmptyState } from '@/components/glass/empty-state';
import { RolesManager } from '@/components/roles/roles-manager';

export default function RolesPage() {
  const { user } = useAuth();
  const allowed = !!user && can(user, 'manageRoles');

  if (!allowed) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Admin" title="Roles & permissions" icon={ShieldCheck} />
        <EmptyState
          icon={ShieldCheck}
          title="No access"
          description="Only leadership can manage roles and permissions."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Roles & permissions"
        icon={ShieldCheck}
        description="Create your own roles and control exactly what each one can do — flip any single permission on or off."
      />
      <RolesManager />
    </div>
  );
}
