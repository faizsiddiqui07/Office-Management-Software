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

      {/* `grid-cols-1` yahan dikhne ke liye nahi hai — ye wo cheez hai jo card ko phone par
          sikudne DETI hai. Bina iske phone par ek anam (implicit) column banta hai jiski naap
          `auto` hoti hai, aur `auto` kabhi apne content ki min-content se neeche nahi jaati.
          Grid ka column SABSE CHAUDE item ke hisaab se banta hai, to `MAGNECRON_FINOLEGAL`
          jaisi ek lambi key (jo tootti hi nahi) poori kataar ko 379px ka kar deti thi —
          jabki screen par 343px the. Natija: SAARE nau card 20px bahar, aur poora panna
          daayein khisakta tha. Tailwind ka `grid-cols-1` = `repeat(1, minmax(0,1fr))`, aur
          wahi `minmax(0, …)` farsh ko 0 kar deta hai. `sm:grid-cols-2` pehle se surakshit tha
          (Tailwind use bhi minmax(0,1fr) se banata hai) — isliye laptop par ye kabhi nahi dikha.
          Owner ne 25 Nov 2026 ko pakda. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
        {/* `min-w-0` iss guchchhe par bhi chahiye, sirf andar ke matn par nahi: ye khud bhi
            upar wali flex-kataar ka item hai, aur flex item ka default `min-width: auto`
            use apne content se chhota hone hi nahi deta. Iske bina 320px wale phone par
            andar ka `truncate` chalta hi nahi tha — matn kat-ne ke bajaye badge ko bahar
            dhakel deta tha. */}
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <ShieldCheck className="size-5" />
          </span>
          {/* `title` isliye ki ab kat-na asli haalat hai: lambi key tang screen par ellipsis
              me badal jaati hai, to poora naam hover/long-press par milna chahiye. */}
          <div className="min-w-0">
            <p className="truncate font-semibold" title={role.label}>{role.label}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground" title={role.key}>{role.key}</p>
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
