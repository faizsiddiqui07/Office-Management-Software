'use client';

import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettings, usePublicBranding } from '@/lib/settings';

export function Brand({ className, compact = false }) {
  const { data: settings } = useSettings();
  const { data: branding } = usePublicBranding();
  // Prefer live (authed) settings; fall back to public branding (works on login).
  const b = settings || branding;
  const name = b?.companyName?.trim() || 'Architectus Bureau';

  // Compact (small mobile screens): square app mark — crisp and space-efficient.
  if (compact) {
    return (
      <div className={cn('flex items-center', className)}>
        <img src="/logo.png" alt={name} className="size-10 shrink-0 rounded-lg object-contain" />
      </div>
    );
  }

  // Main wordmark — separate light/dark versions, toggled by theme via CSS.
  const light = (b?.logoLight || b?.logoDark || b?.logoUrl || '').trim();
  const dark = (b?.logoDark || b?.logoUrl || b?.logoLight || '').trim();

  if (light || dark) {
    return (
      <div className={cn('flex items-center', className)}>
        {light ? (
          <img src={light} alt={name} className="block h-9 w-auto max-w-[180px] object-contain dark:hidden" />
        ) : null}
        {dark ? (
          <img src={dark} alt={name} className="hidden h-9 w-auto max-w-[180px] object-contain dark:block" />
        ) : null}
      </div>
    );
  }

  // Text fallback when no logo is uploaded.
  const parts = name.split(' ');
  const line1 = parts[0];
  const line2 = parts.slice(1).join(' ') || 'Workspace';

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-info text-white shadow-glow">
        <Sparkles className="size-5" />
      </span>
      <div className="leading-tight">
        <p className="max-w-[140px] truncate text-sm font-semibold tracking-tight">{line1}</p>
        <p className="max-w-[140px] truncate text-[11px] text-muted-foreground">{line2}</p>
      </div>
    </div>
  );
}
