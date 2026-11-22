'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Users, Mail, Phone, Hash, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, prettyRole, roleName } from '@/lib/permissions';
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

/**
 * Number par tap karne se dialer khule, email par mail app (owner, 22 Nov 2026).
 * Pehle dono saada text the — log number dekh kar haath se dialer me type karte the.
 *
 * YE DO LINE KA KAAM NAHI THA, aur wajah ye hai: poora card pehle ek next/link <Link>
 * ke ANDAR lipta tha. <a> ke andar <a> invalid HTML hai — React hydration par shikayat
 * karta hai aur browser DOM ko khud se todkar dobara jamata hai, yaani ye chup-chaap
 * bigadta (build phir bhi pass ho jaati). Upar se andar wale link ka click bubble hokar
 * /users/:id par le jaata — dialer khulne ki jagah page badal jaata.
 *
 * Isliye ab "stretched link" wala tareeka hai: GlassCard khud relative hai, naam wala
 * <Link> apne after:absolute after:inset-0 se poore card ko clickable banata hai, aur
 * contact wale <a> uske OOPAR (relative z-10) baithte hain. Natija: card pehle jaisa
 * poora-clickable rehta hai, nested anchor banta hi nahi, aur number/email apna kaam
 * karte hain. Card ka <Link> se wapas lapetna mat — wahi purani dikkat lautegi.
 *
 * tel: ke href me number SAAF karke jaata hai. Phone par koi validation kahin nahi hai
 * (profile/page.jsx ka Input plain hai, backend seedha assign karta hai), aur
 * placeholder "+91 …" hai — to asli data me space, dash, bracket sab mil sakta hai.
 * Dikhane wala text jaisa type hua tha waisa hi rehta hai; sirf href saaf hota hai.
 */
function MemberCard({ u }) {
  // Sirf ank aur agla + bacha lo — "+91 88403-18212" jaisa likha number bhi dial ho jaaye.
  const phone = String(u.phone || '').trim();
  const telHref = phone ? 'tel:' + phone.replace(/[^0-9+]/g, '') : null;
  return (
    <GlassCard className="relative flex items-start gap-3 p-4 transition hover:shadow-glow focus-within:ring-1 focus-within:ring-primary/40">
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
          <p className="truncate font-semibold leading-tight">
            {/* after:inset-0 — yahi poore card ko clickable banata hai, bina card ko <a> me lapete. */}
            <Link href={`/users/${u.id}`} className="after:absolute after:inset-0 after:rounded-[inherit] hover:underline">
              {u.name}
            </Link>
          </p>
          {u.employmentType === 'PART_TIME' ? (
            <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 ring-1 ring-warning/25 dark:text-amber-300">
              Part-time
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-sm font-medium text-primary">{u.designation || roleName(u)}</p>
        {u.department ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{u.department}</p> : null}
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Hash className="size-3 shrink-0" />
            <span className="truncate tabular-nums">{u.employeeId}</span>
          </div>
          {u.email ? (
            <div className="flex items-center gap-1.5">
              <Mail className="size-3 shrink-0" />
              {/* relative z-10 — stretched link ke OOPAR, warna card ka click ise kha jaata. */}
              <a
                href={`mailto:${u.email}`}
                className="relative z-10 truncate hover:text-foreground hover:underline"
              >
                {u.email}
              </a>
            </div>
          ) : null}
          {telHref ? (
            <div className="flex items-center gap-1.5">
              <Phone className="size-3 shrink-0" />
              <a href={telHref} className="relative z-10 truncate tabular-nums hover:text-foreground hover:underline">
                {phone}
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </GlassCard>
  );
}

export default function TeamPage() {
  const { user } = useAuth();
  const allowed = !!user && can(user, 'viewEveryone');
  const { data, isLoading, isError } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users'), enabled: allowed });
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
        title="Team"
        icon={Users}
        description={`Everyone on the team${users.length ? ` · ${users.length} members` : ''}, grouped by role.`}
      />

      {!allowed ? (
        <EmptyState icon={ShieldAlert} title="No access" description="You don’t have permission to view the team directory." />
      ) : isLoading ? (
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
