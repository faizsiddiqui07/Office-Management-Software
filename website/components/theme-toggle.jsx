'use client';

import * as React from 'react';
import { useThemeTransition } from '@/lib/use-theme-transition';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ThemeToggle({ className }) {
  const { resolvedTheme, setThemeSmooth } = useThemeTransition();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setThemeSmooth(isDark ? 'light' : 'dark')}
      className={cn(
        'glass-subtle relative inline-flex size-8 items-center justify-center rounded-xl text-foreground/80 ring-1 ring-border/60 transition-colors hover:text-foreground',
        className,
      )}
    >
      {mounted ? (
        isDark ? <Sun className="size-4" /> : <Moon className="size-4" />
      ) : (
        <span className="size-4" />
      )}
    </button>
  );
}
