'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  FileText,
  Lock,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Brand } from '@/components/shell/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/lib/auth';
import { usePublicBranding } from '@/lib/settings';

const features = [
  { icon: CalendarClock, title: 'Smart attendance', desc: 'Check-in, late and overtime — captured automatically.' },
  { icon: CalendarDays, title: 'Leave management', desc: '18 paid leaves a year, auto-deducted on approval.' },
  { icon: FileText, title: 'Instant reports', desc: 'Daily to yearly PDF reports in a single click.' },
];

export default function LoginPage() {
  const router = useRouter();
  const { user, isLoading, login } = useAuth();
  const { data: branding } = usePublicBranding();
  const companyName = branding?.companyName?.trim() || 'Architectus Bureau';
  // Left panel is always a dark gradient → always use the light (dark-mode) logo.
  const panelLogo = branding?.logoDark || branding?.logoUrl || branding?.logoLight || '/logo.png';
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!isLoading && user) router.replace('/dashboard');
  }, [isLoading, user, router]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success('Welcome back!');
      router.replace('/dashboard');
    } catch (err) {
      toast.error(err?.message || 'Could not sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-dvh">
      <div className="grid min-h-dvh lg:grid-cols-2">
        {/* ── Left: branded visual (50%) ─────────────────────── */}
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-primary via-indigo-600 to-violet-700 p-12 text-white lg:flex">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 -top-24 size-80 rounded-full bg-white/15 blur-3xl" />
            <div className="absolute bottom-0 right-0 size-96 translate-x-1/3 translate-y-1/3 rounded-full bg-fuchsia-400/20 blur-3xl" />
            <div
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.4) 1px, transparent 1px)',
                backgroundSize: '44px 44px',
                maskImage: 'radial-gradient(ellipse 90% 80% at 30% 20%, #000 30%, transparent 75%)',
                WebkitMaskImage: 'radial-gradient(ellipse 90% 80% at 30% 20%, #000 30%, transparent 75%)',
              }}
            />
          </div>

          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={panelLogo} alt={companyName} className="h-12 w-auto max-w-[260px] object-contain" />
          </div>

          <div className="relative space-y-8">
            <div className="space-y-3">
              <h2 className="text-4xl font-semibold leading-[1.1] tracking-tight">
                Run your office,
                <br />
                beautifully.
              </h2>
              <p className="max-w-sm text-[0.95rem] leading-relaxed text-white/75">
                Attendance, leaves, announcements, expenses and reports — one calm, connected workspace for
                your whole team.
              </p>
            </div>

            <ul className="space-y-3">
              {features.map((f) => {
                const Icon = f.icon;
                return (
                  <li
                    key={f.title}
                    className="flex items-start gap-3 rounded-2xl bg-white/10 p-3.5 ring-1 ring-white/15 backdrop-blur-sm"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
                      <Icon className="size-5" />
                    </span>
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{f.title}</p>
                      <p className="text-xs text-white/70">{f.desc}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="relative flex items-center justify-between text-xs text-white/60">
            <span>© 2026 {companyName}</span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-4" /> Secure &amp; private
            </span>
          </div>
        </aside>

        {/* ── Right: sign-in form (50%) ──────────────────────── */}
        <section className="relative flex items-center justify-center px-6 py-12 sm:px-10">
          <div className="absolute right-5 top-5">
            <ThemeToggle />
          </div>

          <div className="w-full max-w-md">
            <div className="mb-10 flex justify-center lg:hidden">
              <Brand />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Welcome back</h1>
              <p className="text-sm text-muted-foreground">Sign in to your office workspace to continue.</p>
            </div>

            <form onSubmit={onSubmit} className="mt-8 space-y-4">
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

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <PasswordInput
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-11 bg-background/50 pl-9"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-0.5">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" className="size-4 rounded border-border accent-primary" />
                  Remember me
                </label>
                <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>

              <Button type="submit" disabled={loading} className="h-11 w-full text-[0.95rem]">
                {loading ? 'Signing in…' : 'Sign in'}
                {!loading ? <ArrowRight className="size-4" /> : null}
              </Button>
            </form>

            <p className="mt-8 text-center text-xs text-muted-foreground">
              Trouble signing in? Contact your office administrator.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
