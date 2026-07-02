'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, MailCheck, Mail } from 'lucide-react';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Brand } from '@/components/shell/brand';
import { ThemeToggle } from '@/components/theme-toggle';

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      toast.error(err?.message || 'Something went wrong');
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
            {sent ? (
              <>
                <span className="mt-6 flex size-12 items-center justify-center rounded-2xl bg-success/12 text-success ring-1 ring-success/20">
                  <MailCheck className="size-6" />
                </span>
                <h1 className="mt-4 text-2xl font-semibold tracking-tight">Check your email</h1>
                <p className="mt-2 break-words text-sm text-muted-foreground">
                  If an account exists for <span className="font-medium text-foreground">{email}</span>, we&apos;ve
                  sent a reset link. It expires in about 30 minutes.
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Didn&apos;t get it? Check your spam folder, or try again in a few minutes.
                </p>
              </>
            ) : (
              <>
                <h1 className="mt-6 text-2xl font-semibold tracking-tight">Forgot password?</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Enter your email and we&apos;ll send you a reset link.
                </p>
                <form onSubmit={onSubmit} className="mt-7 w-full space-y-4 text-left">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        className="h-11 bg-background/50 pl-9"
                        required
                      />
                    </div>
                  </div>
                  <Button type="submit" disabled={loading} className="h-11 w-full">
                    {loading ? 'Sending…' : 'Send reset link'}
                  </Button>
                </form>
              </>
            )}
          </div>

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
