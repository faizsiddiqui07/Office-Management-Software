'use client';

import * as React from 'react';
import { Lock, Pencil, Plus, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { useRoles, usePermissionCatalog } from '@/lib/use-roles';
import { GlassCard } from '@/components/glass/glass-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingState } from '@/components/glass/skeletons';
import { RoleEditorDialog } from './role-editor-dialog';

export function RolesManager() {
  const { data: roles = [], isLoading } = useRoles();
  const { data: catalogData } = usePermissionCatalog();
  const [editing, setEditing] = React.useState(null); // role object | 'new' | null

  const catalog = catalogData?.catalog ?? [];
  const base = catalogData?.base ?? [];
  const totalPerms = catalog.reduce((n, g) => n + g.permissions.length, 0);

  if (isLoading) return <LoadingState label="Loading roles…" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {roles.length} role{roles.length === 1 ? '' : 's'} · {totalPerms} permissions you can toggle
        </p>
        <Button onClick={() => setEditing('new')} className="w-full sm:w-auto">
          <Plus /> Create role
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {roles.map((role) => (
          <RoleCard key={role.id} role={role} totalPerms={totalPerms} onEdit={() => setEditing(role)} />
        ))}
      </div>

      {editing ? (
        <RoleEditorDialog
          key={editing === 'new' ? 'new' : editing.id}
          role={editing === 'new' ? null : editing}
          catalog={catalog}
          base={base}
          open={!!editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function RoleCard({ role, totalPerms, onEdit }) {
  const granted = role.permissions.length;
  const full = granted >= totalPerms && totalPerms > 0;
  return (
    <GlassCard className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{role.label}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{role.key}</p>
          </div>
        </div>
        {role.isSystem ? (
          <Badge variant="secondary" className="shrink-0">
            <Lock /> Built-in
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0">
            <Sparkles /> Custom
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-4" /> {role.userCount} user{role.userCount === 1 ? '' : 's'}
        </span>
        <span>
          <span className={full ? 'font-medium text-primary' : 'font-medium text-foreground'}>{granted}</span>
          /{totalPerms} permissions
        </span>
      </div>

      <Button variant="outline" size="sm" className="mt-auto w-full" onClick={onEdit}>
        <Pencil /> Edit permissions
      </Button>
    </GlassCard>
  );
}
