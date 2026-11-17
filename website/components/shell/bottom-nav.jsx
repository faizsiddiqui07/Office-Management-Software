'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useChatUnread } from '@/lib/chat';
import { navItemsFor } from '@/lib/permissions';
import { useNavBadges } from '@/lib/badges';
import { cn } from '@/lib/utils';
import { MobileNavDrawer } from './mobile-sidebar';

/**
 * The phone and tablet navigation bar, pinned to the bottom of the screen.
 *
 * Four destinations plus More, the way a phone app does it — the thumb sits at the bottom
 * of a phone, and the whole nav used to be behind a hamburger in the top-left corner,
 * which is the furthest point from it. Owner asked for this (17 Nov 2026).
 *
 * WHICH FOUR. Twenty-one pages do not fit, so the four are the ones every single person
 * opens every day and that no permission can take away: Dashboard, To-Do, Chat,
 * Attendance. Everything else — including the pages only some roles have — lives behind
 * More, which opens the same drawer the hamburger used to, with the same full list in the
 * same order. One nav list, two ways in; nothing can drift apart.
 *
 * They are still filtered through navItemsFor, so a tab can never point at a page the
 * person is not allowed to open. If a filter ever removed one, the bar simply renders
 * fewer tabs rather than a dead one.
 *
 * `lg:hidden` is not a guess: lg is exactly where the real sidebar appears, so this bar
 * and the sidebar are never on screen together.
 *
 * SAFE AREA. `pb-[env(safe-area-inset-bottom)]` is there for the iPhone's home indicator.
 * Today it resolves to 0, because the app does not set `viewport-fit=cover` and iOS
 * therefore hands us a viewport that already stops above the indicator — so the bar sits
 * exactly where it should. Written anyway: the day anybody adds that flag, this bar keeps
 * its footing instead of sliding under the indicator, and it costs nothing until then.
 *
 * NO ANIMATION on the active state. Lite mode switches every animation off app-wide, so a
 * control whose feedback depends on one reads as dead there (that is the whole of the
 * "Refresh does nothing" report from 31 Oct). Colour and weight do the work instead;
 * `transition-colors` is safe, since Lite mode only makes it instant.
 */

// Everyone has these four, whatever their role — see the note above.
const PRIMARY = ['/dashboard', '/todo', '/chat', '/attendance'];

// A tab is about a sixth of a 360px screen. "Dashboard" does not fit and came out as
// "Dashb…", which is worse than a shorter word that fits whole. Only the bar uses these;
// the drawer and the desktop sidebar keep the real names, and nothing else reads them.
const SHORT = { '/dashboard': 'Home' };

export function BottomNav() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const hasDot = useNavBadges();
  const unread = useChatUnread();

  // Close the drawer on every route change — the drawer does this too, but a tab tapped
  // from inside it should not leave the sheet hanging while the page changes behind it.
  React.useEffect(() => { setMenuOpen(false); }, [pathname]);

  const allowed = navItemsFor(user);
  const tabs = PRIMARY.map((href) => allowed.find((i) => i.href === href)).filter(Boolean);
  // A dot on More when anything hidden behind it has news. Without this the only way to
  // find out would be to open the drawer and look, which is the opposite of what a dot
  // is for.
  const moreDot = allowed.some((i) => !PRIMARY.includes(i.href) && hasDot(i.href));

  // The chat page is the one screen that needs every pixel on a phone: it is a full-height
  // pane with its own composer pinned above the keyboard, and the shell already drops its
  // other furniture there for exactly this reason (see AppShell). The way out is still the
  // logo and the account menu in the header.
  const onChat = pathname === '/chat' || pathname?.startsWith('/chat/');

  return (
    <>
      <nav
        aria-label="Main"
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 lg:hidden',
          'border-t border-border/60 bg-card/85 backdrop-blur-2xl',
          'pb-[env(safe-area-inset-bottom)]',
          onChat && 'max-sm:hidden',
        )}
      >
        <div className="mx-auto flex max-w-2xl items-stretch justify-around px-1">
          {tabs.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            const isChat = item.href === '/chat';
            // The unread COUNT rides the Chat tab now. The floating chat button carried it
            // before and is hidden here (it would have sat on top of this bar, pointing at
            // a tab two centimetres away), so the number has to live somewhere.
            const count = isChat && unread ? unread : 0;
            const dot = !count && hasDot(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  // h-14 + the label keeps every tab well past the 44px a thumb needs.
                  'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 pb-1.5 pt-2 transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground active:text-foreground',
                )}
              >
                <span className="relative">
                  <Icon className="size-[22px]" strokeWidth={active ? 2.4 : 1.8} />
                  {count ? (
                    <span className="absolute -right-2 -top-1.5 grid min-w-[18px] place-items-center rounded-full bg-destructive px-1 py-px text-[10px] font-bold leading-none text-white ring-2 ring-card">
                      {count > 99 ? '99+' : count}
                    </span>
                  ) : dot ? (
                    <span className="absolute -right-1 -top-0.5 size-2 rounded-full bg-destructive ring-2 ring-card" />
                  ) : null}
                </span>
                <span className={cn('max-w-full truncate text-[11px] leading-none', active ? 'font-semibold' : 'font-medium')}>
                  {SHORT[item.href] || item.label}
                </span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            className={cn(
              'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 pb-1.5 pt-2 transition-colors',
              menuOpen ? 'text-primary' : 'text-muted-foreground active:text-foreground',
            )}
          >
            <span className="relative">
              <Menu className="size-[22px]" strokeWidth={menuOpen ? 2.4 : 1.8} />
              {moreDot ? <span className="absolute -right-1 -top-0.5 size-2 rounded-full bg-destructive ring-2 ring-card" /> : null}
            </span>
            <span className={cn('text-[11px] leading-none', menuOpen ? 'font-semibold' : 'font-medium')}>More</span>
          </button>
        </div>
      </nav>

      {/* The same drawer the hamburger opened, now driven from here. */}
      <MobileNavDrawer user={user} open={menuOpen} onOpenChange={setMenuOpen} />
    </>
  );
}
