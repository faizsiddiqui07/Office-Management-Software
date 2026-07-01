'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
