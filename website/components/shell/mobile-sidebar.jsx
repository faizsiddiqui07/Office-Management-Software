'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { navItemsFor } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { Brand } from './brand';

/**
 * Mobile navigation drawer — a hamburger button (shown below `lg`) that slides a
 * left sidebar in with the FULL nav list. Replaces the old bottom tab bar.
 */
export function MobileSidebar({ user }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const items = navItemsFor(user);

  // Close the drawer whenever the route changes.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            type="button"
            aria-label="Open menu"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground lg:hidden"
          >
            <Menu className="size-[18px]" />
          </button>
        }
      />
      <SheetContent
        side="left"
        className="w-72 max-w-[82vw] gap-0 border-border/60 bg-card/95 p-0 backdrop-blur-2xl"
      >
        <SheetTitle className="sr-only">Navigation menu</SheetTitle>
        <div className="flex h-full flex-col p-4">
          <Link href="/dashboard" className="px-1" onClick={() => setOpen(false)}>
            <Brand />
          </Link>

          <nav className="mt-6 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-2">
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary/10 text-primary ring-1 ring-primary/15'
                      : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                  )}
                >
                  <Icon className="size-[18px]" />
                  <span className="flex-1">{item.label}</span>
                  {active ? <span className="size-1.5 rounded-full bg-primary" /> : null}
                </Link>
              );
            })}
          </nav>
        </div>
      </SheetContent>
    </Sheet>
  );
}
