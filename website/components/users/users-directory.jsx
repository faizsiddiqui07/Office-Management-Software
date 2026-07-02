'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ellipsis, KeyRound, Pencil, Power } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, prettyRole } from '@/lib/permissions';
import { useRoleOptions } from '@/lib/use-roles';
import { DataTable } from '@/components/glass/data-table';
import { StatusBadge } from '@/components/glass/status-badge';
import { TableSkeleton } from '@/components/glass/skeletons';
import { AppDialog } from '@/components/glass/app-dialog';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreateUserDialog } from './create-user-dialog';
import { EditUserDialog } from './edit-user-dialog';
import { TempPasswordContent } from './temp-password-content';

function formatJoined(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function UsersDirectory() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canManage = !!user && can(user, 'manageUsers');
  const canReset = !!user && can(user, 'resetCredentials');
  const canCreate = !!user && can(user, 'createUsers');

  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users') });
  const users = data?.users ?? [];
  const { data: roleOptions = [] } = useRoleOptions();

  const [roleFilter, setRoleFilter] = React.useState('ALL');
  const [statusFilter, setStatusFilter] = React.useState('ALL');
  const filtered = users.filter(
    (u) =>
      (roleFilter === 'ALL' || u.role === roleFilter) &&
      (statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? u.isActive : !u.isActive)),
  );

  const [editing, setEditing] = React.useState(null);
  const [resetResult, setResetResult] = React.useState(null);
  const [toggling, setToggling] = React.useState(null);

  const resetMut = useMutation({
    mutationFn: (id) => api.post(`/users/${id}/reset-credentials`),
    onSuccess: (res) => {
      setResetResult(res);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not reset credentials'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }) => api.patch(`/users/${id}`, { isActive }),
    onSuccess: () => {
      toast.success('User updated');
      qc.invalidateQueries({ queryKey: ['users'] });
      setToggling(null);
    },
    onError: (e) => toast.error(e?.message || 'Could not update'),
  });

  const columns = React.useMemo(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (r) => `${r.name} ${r.email} ${r.employeeId}`,
        cell: ({ row }) => (
          <Link href={`/users/${row.original.id}`} className="group block">
            <p className="font-medium group-hover:text-primary group-hover:underline">{row.original.name}</p>
            <p className="text-xs text-muted-foreground">{row.original.email}</p>
          </Link>
        ),
      },
      { id: 'employeeId', header: 'ID', cell: ({ row }) => <span className="text-sm tabular-nums text-muted-foreground">{row.original.employeeId}</span> },
      {
        id: 'role',
        header: 'Role',
        cell: ({ row }) => (
          <StatusBadge tone="primary" dot={false}>
            {prettyRole(row.original.role)}
          </StatusBadge>
        ),
      },
      { id: 'department', header: 'Department', cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.department || '—'}</span> },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <StatusBadge tone={row.original.isActive ? 'success' : 'neutral'}>{row.original.isActive ? 'Active' : 'Inactive'}</StatusBadge>
        ),
      },
      { id: 'joined', header: 'Joined', cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatJoined(row.original.dateOfJoining)}</span> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          canManage || canReset ? (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
                  <Ellipsis className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="border-border/60 bg-card/90 ring-1 ring-white/10 backdrop-blur-2xl">
                  {canManage ? (
                    <DropdownMenuItem onClick={() => setEditing(row.original)}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                  ) : null}
                  {canReset ? (
                    <DropdownMenuItem onClick={() => resetMut.mutate(row.original.id)}>
                      <KeyRound /> Reset credentials
                    </DropdownMenuItem>
                  ) : null}
                  {canManage && row.original.id !== user.id ? (
                    <DropdownMenuItem
                      variant={row.original.isActive ? 'destructive' : 'default'}
                      onClick={() => setToggling(row.original)}
                    >
                      <Power /> {row.original.isActive ? 'Deactivate' : 'Activate'}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null,
      },
    ],
    [canManage, canReset, resetMut, user],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-9 w-full bg-background/50 sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All roles</SelectItem>
            {roleOptions.map((r) => (
              <SelectItem key={r.key} value={r.key}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-full bg-background/50 sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All status</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectContent>
        </Select>
        {canCreate ? (
          <div className="w-full sm:ml-auto sm:w-auto">
            <CreateUserDialog />
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : (
        <DataTable columns={columns} data={filtered} searchPlaceholder="Search people…" pageSize={12} emptyMessage="No users found." />
      )}

      {editing ? (
        <EditUserDialog
          user={editing}
          open={!!editing}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      ) : null}

      <AppDialog
        open={!!resetResult}
        onOpenChange={(o) => {
          if (!o) setResetResult(null);
        }}
        title="New credentials generated"
        footer={<Button onClick={() => setResetResult(null)}>Done</Button>}
      >
        {resetResult ? <TempPasswordContent user={resetResult.user} temporaryPassword={resetResult.temporaryPassword} /> : null}
      </AppDialog>

      <ConfirmDialog
        open={!!toggling}
        onOpenChange={(o) => {
          if (!o) setToggling(null);
        }}
        title={toggling?.isActive ? 'Deactivate this user?' : 'Activate this user?'}
        description={toggling ? `${toggling.name} will be ${toggling.isActive ? 'unable to sign in' : 'able to sign in again'}.` : ''}
        tone={toggling?.isActive ? 'destructive' : 'default'}
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Activate'}
        loading={toggleMut.isPending}
        onConfirm={() => toggling && toggleMut.mutate({ id: toggling.id, isActive: !toggling.isActive })}
      />
    </div>
  );
}
