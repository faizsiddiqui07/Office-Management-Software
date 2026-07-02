'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ListTodo } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LEADERSHIP, can } from '@/lib/permissions';
import { useRoleOptions } from '@/lib/use-roles';
import { EmploymentFields, DEFAULT_SCHEDULE } from './employment-fields';

export function EditUserDialog({ user: target, open, onOpenChange }) {
  const { user: actor } = useAuth();
  const qc = useQueryClient();
  const isSelf = actor?.id === target.id;
  const { data: roleOptions = [] } = useRoleOptions();
  const isLeader = LEADERSHIP.includes(actor?.role);
  const assignableRoles = roleOptions.filter((r) => isLeader || !LEADERSHIP.includes(r.key));

  const [name, setName] = React.useState('');
  const [department, setDepartment] = React.useState('');
  const [designation, setDesignation] = React.useState('');
  const [role, setRole] = React.useState('EMPLOYEE');
  const [isActive, setIsActive] = React.useState(true);
  const [employmentType, setEmploymentType] = React.useState('FULL_TIME');
  const [schedule, setSchedule] = React.useState({ ...DEFAULT_SCHEDULE });

  const canManage = can(actor, 'manageUsers');
  const [quota, setQuota] = React.useState('');
  const [used, setUsed] = React.useState('');

  // Task delegation access (per person): NONE | ALL | SELECTED + chosen people.
  const [assignMode, setAssignMode] = React.useState('NONE');
  const [assignUsers, setAssignUsers] = React.useState(() => new Set());
  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users'),
    enabled: open && canManage,
  });
  const peopleOptions = (usersData?.users ?? []).filter((u) => u.isActive !== false && u.id !== target.id);

  React.useEffect(() => {
    if (!open) return;
    setName(target.name || '');
    setDepartment(target.department || '');
    setDesignation(target.designation || '');
    setRole(target.role || 'EMPLOYEE');
    setIsActive(target.isActive !== false);
    setEmploymentType(target.employmentType || 'FULL_TIME');
    setSchedule({
      workStart: target.schedule?.workStart || DEFAULT_SCHEDULE.workStart,
      workEnd: target.schedule?.workEnd || DEFAULT_SCHEDULE.workEnd,
      graceMinutes: target.schedule?.graceMinutes ?? 0,
    });
    setAssignMode(target.taskAssign?.mode || 'NONE');
    setAssignUsers(new Set((target.taskAssign?.users || []).map(String)));
  }, [open, target]);

  // Current fiscal-year leave balance (for the leadership override below).
  const { data: balData } = useQuery({
    queryKey: ['user-leave-balance', target.id],
    queryFn: () => api.get(`/users/${target.id}/leave-balance`),
    enabled: open && canManage,
  });
  React.useEffect(() => {
    if (balData?.balance) {
      setQuota(String(balData.balance.totalQuota ?? ''));
      setUsed(String(balData.balance.used ?? ''));
    }
  }, [balData]);

  const mut = useMutation({
    mutationFn: async () => {
      if (employmentType === 'PART_TIME' && (!schedule.workStart || !schedule.workEnd)) {
        throw new Error('Part-time needs a check-in and check-out time');
      }
      await api.patch(`/users/${target.id}`, {
        name,
        department,
        designation,
        role,
        isActive,
        employmentType,
        schedule: employmentType === 'PART_TIME' ? schedule : undefined,
        taskAssign: { mode: assignMode, users: assignMode === 'SELECTED' ? [...assignUsers] : [] },
      });
      if (canManage) {
        const payload = {};
        if (quota !== '') payload.totalQuota = Number(quota);
        if (used !== '') payload.used = Number(used);
        if (payload.totalQuota !== undefined || payload.used !== undefined) {
          await api.patch(`/users/${target.id}/leave-balance`, payload);
        }
      }
    },
    onSuccess: () => {
      toast.success('User updated');
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['user-leave-balance', target.id] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e?.message || 'Could not update user'),
  });

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${target.name}`}
      description={`${target.email} · ${target.employeeId}`}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto py-2">
        <div className="space-y-1.5">
          <Label htmlFor="eu-name">Full name</Label>
          <Input id="eu-name" value={name} onChange={(e) => setName(e.target.value)} className="bg-background/50" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="eu-dept">Department</Label>
            <Input id="eu-dept" value={department} onChange={(e) => setDepartment(e.target.value)} className="bg-background/50" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eu-desg">Designation</Label>
            <Input id="eu-desg" value={designation} onChange={(e) => setDesignation(e.target.value)} className="bg-background/50" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eu-role">Role</Label>
          <Select value={role} onValueChange={setRole} disabled={isSelf}>
            <SelectTrigger id="eu-role" className="w-full bg-background/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assignableRoles.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isSelf ? <p className="text-xs text-muted-foreground">You can&apos;t change your own role.</p> : null}
        </div>
        <div className="flex items-center justify-between rounded-xl bg-foreground/[0.04] p-3 ring-1 ring-border/50">
          <div>
            <Label htmlFor="eu-active">Active</Label>
            <p className="text-xs text-muted-foreground">Inactive users can&apos;t sign in.</p>
          </div>
          <Switch id="eu-active" checked={isActive} onCheckedChange={setIsActive} disabled={isSelf} />
        </div>

        <EmploymentFields
          employmentType={employmentType}
          schedule={schedule}
          onTypeChange={setEmploymentType}
          onScheduleChange={setSchedule}
        />

        {canManage ? (
          <div className="space-y-3 rounded-xl bg-primary/[0.05] p-3 ring-1 ring-primary/15">
            <div className="flex items-center gap-2">
              <ListTodo className="size-4 text-primary" />
              <p className="text-sm font-medium">Task assignment access</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Who can {target.name?.split(' ')[0] || 'this person'} give work to? This is the only place that controls it.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: 'NONE', label: 'No one' },
                { v: 'ALL', label: 'Everyone' },
                { v: 'SELECTED', label: 'Selected' },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setAssignMode(o.v)}
                  className={`rounded-lg px-2 py-2 text-sm font-medium ring-1 transition-colors ${
                    assignMode === o.v
                      ? 'bg-primary text-primary-foreground ring-primary'
                      : 'bg-background/50 text-muted-foreground ring-border hover:text-foreground'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {assignMode === 'SELECTED' ? (
              <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg bg-background/40 p-1.5 ring-1 ring-border/50">
                {peopleOptions.length ? (
                  peopleOptions.map((u) => (
                    <label
                      key={u.id}
                      htmlFor={`ta-${u.id}`}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-foreground/[0.04]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{u.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{u.designation || u.department || u.employeeId}</span>
                      </span>
                      <Switch
                        id={`ta-${u.id}`}
                        checked={assignUsers.has(u.id)}
                        onCheckedChange={() =>
                          setAssignUsers((prev) => {
                            const next = new Set(prev);
                            if (next.has(u.id)) next.delete(u.id);
                            else next.add(u.id);
                            return next;
                          })
                        }
                      />
                    </label>
                  ))
                ) : (
                  <p className="px-2 py-2 text-xs text-muted-foreground">No other active users.</p>
                )}
              </div>
            ) : assignMode === 'ALL' ? (
              <p className="text-xs text-muted-foreground">Can assign work to every active user.</p>
            ) : (
              <p className="text-xs text-muted-foreground">The Assign button won’t appear for them.</p>
            )}
          </div>
        ) : null}

        {canManage ? (
          <div className="space-y-3 rounded-xl bg-foreground/[0.04] p-3 ring-1 ring-border/50">
            <div>
              <p className="text-sm font-medium">Leave balance</p>
              <p className="text-xs text-muted-foreground">
                Current fiscal year (Apr–Mar). Set the quota, or adjust already-taken days when onboarding mid-year.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="eu-quota">Total quota</Label>
                <Input id="eu-quota" type="number" min="0" value={quota} onChange={(e) => setQuota(e.target.value)} className="bg-background/50" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eu-used">Used (taken)</Label>
                <Input id="eu-used" type="number" min="0" value={used} onChange={(e) => setUsed(e.target.value)} className="bg-background/50" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Remaining: <span className="font-medium tabular-nums text-foreground">{(Number(quota) || 0) - (Number(used) || 0)}</span> days
            </p>
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}
