'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCheck, Lock, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

// Friendly labels for the always-on base permissions every role keeps.
const BASE_LABELS = {
  markAttendance: 'Mark attendance',
  viewOwn: 'View own records',
  applyLeave: 'Apply for leave',
  viewAnnouncements: 'Read announcements',
  viewCalendar: 'View the calendar',
};

export function RoleEditorDialog({ role, catalog, base = [], open, onClose }) {
  const qc = useQueryClient();
  const isNew = !role;
  const isSystem = !!role?.isSystem;

  const [label, setLabel] = React.useState(role?.label ?? '');
  const [selected, setSelected] = React.useState(() => new Set(role?.permissions ?? []));
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const grantedCount = selected.size;
  const totalCount = catalog.reduce((n, g) => n + g.permissions.length, 0);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['roles'] });
    qc.invalidateQueries({ queryKey: ['role-options'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const permissions = [...selected];
      if (isNew) return api.post('/roles', { label: label.trim(), permissions });
      const body = { permissions };
      if (!isSystem) body.label = label.trim();
      return api.put(`/roles/${role.id}`, body);
    },
    onSuccess: () => {
      toast.success(isNew ? 'Role created' : 'Permissions updated');
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(e?.message || 'Could not save role'),
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/roles/${role.id}`),
    onSuccess: () => {
      toast.success('Role deleted');
      invalidate();
      setConfirmDelete(false);
      onClose();
    },
    onError: (e) => {
      toast.error(e?.message || 'Could not delete role');
      setConfirmDelete(false);
    },
  });

  const toggle = (key) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setGroup = (group, on) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of group.permissions) {
        if (on) next.add(p.key);
        else next.delete(p.key);
      }
      return next;
    });

  const submit = () => {
    if (isNew && !label.trim()) return toast.error('Give the role a name');
    save.mutate();
  };

  return (
    <>
      <AppDialog
        open={open}
        onOpenChange={(o) => (!o ? onClose() : null)}
        className="sm:max-w-2xl"
        title={isNew ? 'Create role' : `Edit ${role.label}`}
        description={
          isNew
            ? 'Name the role, then switch on exactly the permissions it should have.'
            : isSystem
              ? 'Built-in role — its name is fixed, but you can fine-tune every permission.'
              : 'Rename the role or fine-tune any single permission.'
        }
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            {!isNew && !isSystem ? (
              <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : isNew ? 'Create role' : 'Save changes'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="max-h-[65vh] space-y-5 overflow-y-auto py-1 pr-1">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="role-label">Role name</Label>
            {isSystem ? (
              <div className="flex items-center gap-2 rounded-lg bg-foreground/[0.04] px-3 py-2 text-sm ring-1 ring-border/50">
                <Lock className="size-4 text-muted-foreground" />
                <span className="font-medium">{role.label}</span>
                <Badge variant="secondary" className="ml-auto">
                  Built-in
                </Badge>
              </div>
            ) : (
              <Input
                id="role-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Floor Supervisor"
                className="bg-background/50"
              />
            )}
          </div>

          {/* Counter */}
          <div className="flex items-center justify-between rounded-lg bg-primary/[0.06] px-3 py-2 text-sm ring-1 ring-primary/10">
            <span className="text-muted-foreground">Granted permissions</span>
            <span className="font-semibold text-primary">
              {grantedCount}
              <span className="text-muted-foreground"> / {totalCount}</span>
            </span>
          </div>

          {/* Base note */}
          {base.length ? (
            <p className="text-xs text-muted-foreground">
              Every role automatically includes:{' '}
              <span className="text-foreground/70">
                {base.map((k) => BASE_LABELS[k] || k).join(', ')}
              </span>
              .
            </p>
          ) : null}

          {/* Permission groups */}
          <div className="space-y-4">
            {catalog.map((group) => {
              const allOn = group.permissions.every((p) => selected.has(p.key));
              return (
                <div key={group.module} className="rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{group.module}</p>
                    <button
                      type="button"
                      onClick={() => setGroup(group, !allOn)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary/80 transition-colors hover:text-primary"
                    >
                      <CheckCheck className="size-3.5" />
                      {allOn ? 'Clear all' : 'Select all'}
                    </button>
                  </div>
                  <div className="space-y-1">
                    {group.permissions.map((perm) => (
                      <label
                        key={perm.key}
                        htmlFor={`perm-${perm.key}`}
                        className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-foreground/[0.04]"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{perm.label}</span>
                          {perm.description ? (
                            <span className="block text-xs text-muted-foreground">{perm.description}</span>
                          ) : null}
                        </span>
                        <Switch
                          id={`perm-${perm.key}`}
                          checked={selected.has(perm.key)}
                          onCheckedChange={() => toggle(perm.key)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </AppDialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        tone="destructive"
        title={`Delete ${role?.label}?`}
        description="This role will be removed permanently. Users must be reassigned first."
        confirmLabel="Delete role"
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </>
  );
}
