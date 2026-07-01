'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AppDialog } from '@/components/glass/app-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LEADERSHIP } from '@/lib/permissions';
import { useRoleOptions } from '@/lib/use-roles';
import { TempPasswordContent } from './temp-password-content';
import { EmploymentFields, DEFAULT_SCHEDULE } from './employment-fields';

const EMPTY = {
  name: '',
  email: '',
  role: 'EMPLOYEE',
  department: '',
  designation: '',
  employmentType: 'FULL_TIME',
  schedule: { ...DEFAULT_SCHEDULE },
};

export function CreateUserDialog() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY);
  const [result, setResult] = React.useState(null);

  const { data: roleOptions = [] } = useRoleOptions();
  const isLeader = LEADERSHIP.includes(user?.role);
  const assignableRoles = roleOptions.filter((r) => isLeader || !LEADERSHIP.includes(r.key));

  React.useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setResult(null);
    }
  }, [open]);

  const mut = useMutation({
    mutationFn: () => api.post('/users', form),
    onSuccess: (res) => {
      setResult(res);
      toast.success(`${res.user.name} created · ${res.user.employeeId}`);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not create user'),
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = () => {
    if (!form.name.trim()) return toast.error('Add a name');
    if (!form.email.trim()) return toast.error('Add an email');
    if (form.employmentType === 'PART_TIME' && (!form.schedule.workStart || !form.schedule.workEnd)) {
      return toast.error('Part-time needs a check-in and check-out time');
    }
    mut.mutate();
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button className="w-full sm:w-auto">
          <UserPlus /> Create user
        </Button>
      }
      title={result ? 'User created' : 'Create user'}
      description={result ? undefined : 'Generate an account and a one-time temporary password.'}
      footer={
        result ? (
          <Button onClick={() => setOpen(false)}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={mut.isPending}>
              {mut.isPending ? 'Creating…' : 'Create'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <TempPasswordContent user={result.user} temporaryPassword={result.temporaryPassword} />
      ) : (
        <div className="max-h-[70vh] space-y-4 overflow-y-auto py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cu-name">Full name</Label>
            <Input id="cu-name" value={form.name} onChange={set('name')} placeholder="Neha Gupta" className="bg-background/50" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cu-email">Email</Label>
            <Input id="cu-email" type="email" value={form.email} onChange={set('email')} placeholder="name@company.com" className="bg-background/50" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cu-role">Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger id="cu-role" className="w-full bg-background/50">
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
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cu-dept">Department</Label>
              <Input id="cu-dept" value={form.department} onChange={set('department')} placeholder="Engineering" className="bg-background/50" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cu-desg">Designation</Label>
            <Input id="cu-desg" value={form.designation} onChange={set('designation')} placeholder="Software Engineer" className="bg-background/50" />
          </div>
          <EmploymentFields
            employmentType={form.employmentType}
            schedule={form.schedule}
            onTypeChange={(v) => setForm((f) => ({ ...f, employmentType: v }))}
            onScheduleChange={(s) => setForm((f) => ({ ...f, schedule: s }))}
          />
        </div>
      )}
    </AppDialog>
  );
}
