'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Users, Mail, Phone, Hash } from 'lucide-react';
import { api } from '@/lib/api';
import { prettyRole } from '@/lib/permissions';
import { useRoleOptions } from '@/lib/use-roles';
import { PageHeader } from '@/components/glass/page-header';
import { GlassCard } from '@/components/glass/glass-card';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';

function initials(name = '') {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?'
  );
}

function MemberCard({ u }) {
  return (
    <Link href={`/users/${u.id}`} className="block transition hover:opacity-95">
      <GlassCard className="flex items-start gap-3 p-4 transition hover:shadow-glow">
      {u.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={u.avatarUrl} alt="" className="size-12 shrink-0 rounded-full object-cover ring-1 ring-border/50" />
      ) : (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary ring-1 ring-primary/15">
          {initials(u.name)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold leading-tight">{u.name}</p>
          {u.employmentType === 'PART_TIME' ? (
            <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 ring-1 ring-warning/25 dark:text-amber-300">
              Part-time
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-sm font-medium text-primary">{u.designation || prettyRole(u.role)}</p>
        {u.department ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{u.department}</p> : null}
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Hash className="size-3 shrink-0" />
            <span className="truncate tabular-nums">{u.employeeId}</span>
          </div>
          {u.email ? (
            <div className="flex items-center gap-1.5">
              <Mail className="size-3 shrink-0" />
              <span className="truncate">{u.email}</span>
            </div>
          ) : null}
          {u.phone ? (
            <div className="flex items-center gap-1.5">
              <Phone className="size-3 shrink-0" />
              <span className="truncate">{u.phone}</span>
            </div>
          ) : null}
        </div>
      </div>
      </GlassCard>
    </Link>
  );
}

export default function TeamPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users') });
  const { data: roleOptions = [] } = useRoleOptions();

  const users = React.useMemo(() => (data?.users ?? []).filter((u) => u.isActive !== false), [data]);

  const groups = React.useMemo(() => {
    const byRole = new Map();
    for (const u of users) {
      if (!byRole.has(u.role)) byRole.set(u.role, []);
      byRole.get(u.role).push(u);
    }
    for (const arr of byRole.values()) arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    // Order groups by role rank — roleOptions comes back rank-sorted; unknown roles last.
    const order = roleOptions.map((r) => r.key);
    const labelOf = new Map(roleOptions.map((r) => [r.key, r.label]));
    const rank = (k) => {
      const i = order.indexOf(k);
      return i === -1 ? 999 : i;
    };
    return [...byRole.keys()]
      .sort((a, b) => rank(a) - rank(b))
      .map((k) => ({ role: k, label: labelOf.get(k) || prettyRole(k), members: byRole.get(k) }));
  }, [users, roleOptions]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Team"
        title="Team"
        icon={Users}
        description={`Everyone on the team${users.length ? ` · ${users.length} members` : ''}, grouped by role.`}
      />

      {isLoading ? (
        <LoadingState label="Loading the team…" />
      ) : isError ? (
        <EmptyState icon={Users} title="Couldn’t load the team" description="Please refresh in a moment." />
      ) : !users.length ? (
        <EmptyState icon={Users} title="No team members yet" description="Registered people will appear here." />
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.role} className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <h2 className="text-lg font-semibold tracking-tight">{g.label}</h2>
                <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {g.members.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {g.members.map((u) => (
                  <MemberCard key={u.id} u={u} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
