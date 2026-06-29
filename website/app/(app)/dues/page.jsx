'use client';

import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { DuesAdmin } from '@/components/dues/dues-admin';
import { DuesPersonal } from '@/components/dues/dues-personal';

export default function DuesPage() {
  const { user } = useAuth();
  if (!user) return null;
  // Admin Manager manages everyone's ledger; everyone else sees only their own.
  return can(user, 'manageDues') ? <DuesAdmin /> : <DuesPersonal />;
}
