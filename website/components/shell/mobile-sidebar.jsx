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
 * The full navigation list, in a left-hand drawer.
 *
 * It used to own a hamburger button in the header as well. The way in is now the More tab
 * at the bottom of the screen (see bottom-nav.jsx), where a thumb actually rests; two
 * entrances would have put the same list in the two furthest-apart corners. The header
 * button survives on ONE screen — the chat pane at phone width, where the bottom bar
 * steps aside and this would otherwise be unreachable.
 *
 * Still the only place the full list is rendered for a phone, which is the point: the
 * bottom bar shows five destinations, this shows all of them, and both read the same
 * `navItemsFor`, so neither can drift from the other.
 *
 * IT STOPS ABOVE THE BOTTOM BAR (owner, 17 Nov 2026 — "bottom tab bhi show ho"). Both the
 * panel and its backdrop end at the bar's height below `lg`, so the bar stays visible AND
 * tappable while the menu is open: you can jump straight to another tab, or close the menu
 * from the same button that opened it. Insetting the BACKDROP is the half that is easy to
 * forget — a backdrop running under the bar is invisible and still eats every tap.
 * The `!` is deliberate: the Sheet's own `data-[side=left]:inset-y-0` and `h-full` set the
 * same properties, and relying on which utility Tailwind happens to emit last is not worth
 * a layout that breaks on an upgrade.
 */

// EXACTLY the bar's height — its declared row (3.25rem in bottom-nav.jsx) plus the same
// safe-area padding it carries, so the two meet with no seam. The first attempt borrowed
// the page's bottom PADDING (4.75rem), which is deliberately roomier than the bar, and
// left a 24px strip of scrolling page showing between the drawer and the bar.
//
// TWO VERSIONS, because the inset is only right where the bar actually IS. Below `lg`
// that is everywhere — except the chat pane at phone width, where the bar steps aside for
// the composer. Insetting there left a 52px strip at the bottom of the drawer with the
// chat list showing through it and nothing to cover it.
export const NAV_INSET = 'max-lg:bottom-[calc(3.25rem+env(safe-area-inset-bottom))]!';
export const NAV_INSET_FROM_SM = 'sm:max-lg:bottom-[calc(3.25rem+env(safe-area-inset-bottom))]!';

/** The drawer's panel. Separate from the Sheet so the bar can own the trigger — a trigger
 *  INSIDE the Sheet is what keeps "tap More to close" from fighting the outside-press
 *  dismiss, which would close and immediately reopen it. */
export function NavDrawerContent({ user, onNavigate, inset = NAV_INSET }) {
  const pathname = usePathname();
  const items = navItemsFor(user);
  const hasDot = useNavBadges();

  return (
    <SheetContent
      side="left"
      overlayClassName={inset}
      className={cn('w-72 max-w-[82vw] gap-0 border-border/60 bg-card/95 p-0 backdrop-blur-2xl', inset, 'max-lg:h-auto!')}
    >
      <SheetTitle className="sr-only">Navigation menu</SheetTitle>
      <div className="flex h-full flex-col p-4">
        <Link href="/dashboard" className="px-1" onClick={onNavigate}>
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
                onClick={onNavigate}
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
  );
}

/**
 * The drawer with its own Sheet, for a caller whose button sits somewhere this component
 * cannot reach into — the header's hamburger, which exists only on the chat pane.
 *
 * That is also why it takes the `FROM_SM` inset: this drawer only ever opens on chat, and
 * chat is the one route that hides the bar at phone width.
 */
export function MobileNavDrawer({ user, open, onOpenChange }) {
  const pathname = usePathname();

  // Close whenever the route changes, including a tap on a link inside the drawer.
  React.useEffect(() => {
    onOpenChange?.(false);
    // onOpenChange is rebuilt on every render of the parent; depending on it here would
    // close the drawer on the very render that opened it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <NavDrawerContent user={user} inset={NAV_INSET_FROM_SM} onNavigate={() => onOpenChange?.(false)} />
    </Sheet>
  );
}
