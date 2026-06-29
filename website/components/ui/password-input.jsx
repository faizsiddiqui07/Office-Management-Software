'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from './input';

/**
 * Password field with a built-in show/hide toggle. Drops in anywhere a plain
 * `<Input type="password" />` was used — it reserves room on the right for the
 * eye button (`pr-10`) and works both standalone and inside a `relative`
 * wrapper that already has a left-side icon.
 */
export function PasswordInput({ className, ...props }) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative w-full">
      <Input {...props} type={visible ? 'text' : 'password'} className={cn('pr-10', className)} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
