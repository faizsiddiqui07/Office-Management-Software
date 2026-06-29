'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

export function Toaster(props) {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme}
      position="top-right"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'glass-strong group toast rounded-2xl border border-border text-foreground shadow-glass',
          title: 'font-medium',
          description: 'text-muted-foreground',
          actionButton: 'rounded-lg bg-primary text-primary-foreground',
          cancelButton: 'rounded-lg bg-muted text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}
