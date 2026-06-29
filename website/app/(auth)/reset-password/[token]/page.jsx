'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Lock, KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Brand } from '@/components/shell/brand';
import { ThemeToggle } from '@/components/theme-toggle';

export default function ResetPasswordPage({ params }) {
  const router = useRouter();
  const token = params?.token;
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
      await api.post('/auth/reset-password', { token, newPassword: next });
      toast.success('Password reset. Please sign in.');
      router.replace('/login');
    } catch (err) {
      toast.error(err?.message || 'This reset link is invalid or has expired');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="absolute right-5 top-5">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        <div className="glass-strong glass-highlight rounded-3xl p-6 shadow-glass sm:p-8">
          <div className="flex flex-col items-center text-center">
            <Brand />
            <span className="mt-6 flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/20">
              <KeyRound className="size-6" />
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Set a new password</h1>
            <p className="mt-1 text-sm text-muted-foreground">Choose a strong password you don&apos;t use elsewhere.</p>
          </div>

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new">New password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <PasswordInput
                  id="new"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  className="h-11 bg-background/50 pl-9"
                  aria-describedby="new-hint"
                  required
                />
              </div>
              <p id="new-hint" className="text-xs text-muted-foreground">At least 8 characters</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <PasswordInput
                  id="confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="h-11 bg-background/50 pl-9"
                  required
                />
              </div>
            </div>
            <Button type="submit" disabled={loading} className="h-11 w-full">
              {loading ? 'Resetting…' : 'Reset password'}
            </Button>
          </form>

          <Link
            href="/login"
            className="mt-6 flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
