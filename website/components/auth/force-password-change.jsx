'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Lock, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function ForcePasswordChange({ user }) {
  const { refresh, logout } = useAuth();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (next.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (next !== confirm) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      toast.success('Password updated — welcome aboard!');
      await refresh();
    } catch (err) {
      toast.error(err?.message || 'Could not update password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="glass-strong glass-highlight rounded-3xl p-6 shadow-glass sm:p-8">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/20">
              <ShieldCheck className="size-6" />
            </span>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight">Set a new password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Hi {user.name.split(' ')[0]} — for security, please replace your temporary password before continuing.
            </p>
          </div>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <Field id="current" label="Current (temporary) password" value={current} onChange={setCurrent} />
            <Field id="new" label="New password" value={next} onChange={setNext} hint="At least 8 characters" />
            <Field id="confirm" label="Confirm new password" value={confirm} onChange={setConfirm} />

            <Button type="submit" disabled={loading} className="h-11 w-full">
              {loading ? 'Updating…' : 'Update password & continue'}
            </Button>
          </form>

          <button
            type="button"
            onClick={async () => {
              await logout();
              window.location.href = '/login';
            }}
            className="mt-5 w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Sign out instead
          </button>
        </div>
      </div>
    </main>
  );
}

function Field({ id, label, value, onChange, hint }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <PasswordInput
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 bg-background/50 pl-9"
          aria-describedby={hint ? `${id}-hint` : undefined}
          required
        />
      </div>
      {hint ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
