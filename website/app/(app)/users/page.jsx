'use client';

import { Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/glass/page-header';
import { EmptyState } from '@/components/glass/empty-state';
import { UsersDirectory } from '@/components/users/users-directory';

export default function UsersPage() {
  const { user } = useAuth();
  const allowed = !!user && can(user, 'createUsers');

  if (!allowed) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Team" title="Users" icon={Users} />
        <EmptyState icon={Users} title="No access" description="Only admins can manage users and credentials." />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Team"
        title="Users & credentials"
        icon={Users}
        description="The staff directory — create accounts, manage roles and access, and reset credentials."
      />
      <UsersDirectory />
    </div>
  );
}
