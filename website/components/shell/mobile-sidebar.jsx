'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { navItemsFor } from '@/lib/permissions';
import { useNavBadges } from '@/lib/badges';
import { cn } from '@/lib/utils';
import { Brand } from './brand';

/**
 * The full navigation list in a left-hand drawer.
 *
 * CONTROLLED, with no trigger of its own. It used to own both — a hamburger button in the
 * header plus this sheet — but the way in is now the More tab at the bottom of the screen
 * (see bottom-nav.jsx), where a thumb actually rests. Two entrances to one drawer would
 * have meant the same list reachable from the two furthest-apart corners of the screen,
 * so the header button went.
 *
 * Still the ONLY place the full list is rendered for a phone, which is the point: the
 * bottom bar shows four destinations, this shows all of them, and both read the same
 * `navItemsFor` so neither can drift.
 */
export function MobileNavDrawer({ user, open, onOpenChange }) {
  const pathname = usePathname();
  const items = navItemsFor(user);
  const hasDot = useNavBadges();

  // Close whenever the route changes — including a tap on a link inside this drawer.
  React.useEffect(() => {
    onOpenChange?.(false);
    // onOpenChange is recreated on every render of the parent; depending on it here would
    // close the drawer on the render that opened it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-72 max-w-[82vw] gap-0 border-border/60 bg-card/95 p-0 backdrop-blur-2xl"
      >
        <SheetTitle className="sr-only">Navigation menu</SheetTitle>
        <div className="flex h-full flex-col p-4">
          <Link href="/dashboard" className="px-1" onClick={() => onOpenChange?.(false)}>
            <Brand showClient />
          </Link>

          <nav className="mt-6 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-2">
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => onOpenChange?.(false)}
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
                  {hasDot(item.href) ? (
                    <span className="size-2 rounded-full bg-destructive ring-2 ring-destructive/25" aria-label="New" />
                  ) : active ? (
                    <span className="size-1.5 rounded-full bg-primary" />
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>
      </SheetContent>
    </Sheet>
  );
}
