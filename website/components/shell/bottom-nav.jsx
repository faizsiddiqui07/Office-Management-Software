'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ClipboardList, ListTodo, Menu, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { can, navItemsFor } from '@/lib/permissions';
import { useNavBadges } from '@/lib/badges';
import { cn } from '@/lib/utils';
import { Sheet, SheetClose, SheetTrigger } from '@/components/ui/sheet';
import { NavDrawerContent } from './mobile-sidebar';

/**
 * The phone and tablet navigation bar, pinned to the bottom of the screen.
 *
 * Five slots, the way a phone app does it — the thumb rests at the bottom of a phone, and
 * the whole nav used to be behind a hamburger in the top-left corner, which is the
 * furthest point on the screen from it. Owner asked for this (17 Nov 2026).
 *
 * WHAT IS IN THEM, and why these:
 *   Home            — /dashboard
 *   My tasks        — /todo on the "mine" tab
 *   Assigned tasks  — /todo on "assigned by me", as one flat list. Only for somebody who
 *                     can actually delegate; without that there is no such tab to land on.
 *   Attendance      — OR Approvals. See below.
 *   More            — the full list, in the same drawer the hamburger used to open.
 *
 * ATTENDANCE OR APPROVALS, not both. Leadership does not mark attendance — the roster is
 * built from the `markAttendance` permission (attendance.service.js does exactly this), so
 * for Khaan Aamir or Kalpana Saini an Attendance tab is a daily-use slot pointing at
 * something they never do. They get Approvals instead, which is what they open all day.
 * Owner's call, 17 Nov 2026. Somebody with neither simply gets four tabs; a slot is not
 * worth filling with a page that person has no use for.
 *
 * Chat is NOT here. It had a slot for a few hours and the floating button came back
 * instead (owner, 17 Nov) — so these five are the ones a floating button cannot replace.
 *
 * Everything is filtered through `navItemsFor`/`can`, so a tab can never point at a page
 * the person is not allowed to open. If a filter removes one, the bar renders fewer tabs
 * rather than a dead one.
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

export function BottomNav() {
  const { user } = useAuth();
  const pathname = usePathname();
  const params = useSearchParams();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const hasDot = useNavBadges();

  // Close the drawer on every route change — the drawer does this too, but a tab tapped
  // from inside it should not leave the sheet hanging while the page changes behind it.
  React.useEffect(() => { setMenuOpen(false); }, [pathname]);

  const allowed = navItemsFor(user);
  const find = (href) => allowed.find((i) => i.href === href);

  // The same per-person delegation setting the To-Do page gates its "Assigned by me" tab
  // on — somebody who cannot delegate has no such tab, so the shortcut would land them on
  // a tab that isn't there.
  const ta = user?.taskAssign || {};
  const canAssign = ta.mode === 'ALL' || (ta.mode === 'SELECTED' && (ta.users || []).length > 0);

  const onTodo = pathname === '/todo';
  // The board keeps `?tab=` in the URL after consuming a link (it only strips `view` and
  // `jump`), so this is a reliable read of which To-Do tab is open.
  const todoTab = params.get('tab');

  const tabs = [];
  const home = find('/dashboard');
  if (home) tabs.push({ key: 'home', href: '/dashboard', label: 'Home', icon: home.icon, active: pathname === '/dashboard' });

  if (find('/todo')) {
    tabs.push({
      key: 'mine',
      // `?jump=1` scrolls past the stat cards to the list, which on a phone is otherwise
      // below the fold. The board consumes these and strips them, which is what makes a
      // SECOND tap work instead of being a no-op link to where you already are.
      href: '/todo?tab=mine&jump=1',
      label: 'My tasks',
      icon: ListTodo,
      active: onTodo && todoTab !== 'assigned',
      // One dot for the whole To-Do page is all the server sends — it covers both work
      // given to me AND work waiting on my sign-off (getBadges merges the two). It rides
      // this tab alone: the same dot on both To-Do tabs reads as a rendering bug, and
      // this is the tab the page opens on, where opening it clears the dot anyway.
      dot: hasDot('/todo'),
    });
    if (canAssign) {
      tabs.push({
        key: 'assigned',
        href: '/todo?tab=assigned&view=all&jump=1',
        label: 'Assigned',
        icon: ClipboardList,
        active: onTodo && todoTab === 'assigned',
      });
    }
  }

  // Attendance for the people who mark it; Approvals for the people who don't.
  const duty = can(user, 'markAttendance') ? find('/attendance') : find('/approvals');
  if (duty) {
    tabs.push({
      key: duty.href,
      href: duty.href,
      label: duty.label,
      icon: duty.icon,
      active: pathname === duty.href || pathname.startsWith(`${duty.href}/`),
      dot: hasDot(duty.href),
    });
  }

  // A dot on More when anything hidden behind it has news. Without this the only way to
  // find out would be to open the drawer and look, which is the opposite of what a dot
  // is for. `shown` is every href already on the bar, so nothing is counted twice.
  const shown = new Set(tabs.map((t) => (t.href.startsWith('/todo') ? '/todo' : t.href)));
  const moreDot = allowed.some((i) => !shown.has(i.href) && hasDot(i.href));

  // The chat page is the one screen that needs every pixel on a phone: it is a full-height
  // pane with its own composer pinned above the keyboard, and the shell already drops its
  // other furniture there for exactly this reason (see AppShell). The way out is the
  // hamburger the header puts back at exactly this width.
  const onChat = pathname === '/chat' || pathname?.startsWith('/chat/');

  const itemClass = 'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 pb-1.5 pt-2 transition-colors';

  return (
    // The Sheet WRAPS the bar, so the More button can be a real SheetTrigger. A plain
    // button out here would fight the drawer's own outside-press dismiss: the press would
    // close the drawer first and the click handler would reopen it a moment later, so the
    // menu could never be closed from the button that opened it. A trigger is registered
    // with the popup and is exempt from that dismiss — this is exactly what it is for.
    <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
      <nav
        aria-label="Main"
        className={cn(
          // z-40 keeps it under dialogs (z-50) as before. It does NOT need to climb over
          // the drawer: the drawer and its backdrop stop at this bar's top edge instead,
          // so there is nothing here to cover it (see mobile-sidebar.jsx).
          'fixed inset-x-0 bottom-0 z-40 lg:hidden',
          'border-t border-border/60 bg-card/85 backdrop-blur-2xl',
          'pb-[env(safe-area-inset-bottom)]',
          onChat && 'max-sm:hidden',
        )}
      >
        {/* The row's height is DECLARED, not left to emerge from the padding inside the
            tabs — mobile-sidebar.jsx has to stop the drawer exactly here, and a number
            that drifts when somebody nudges a padding would open a strip of page between
            the two. If you change `h-[3.25rem]`, change the inset there to match. */}
        <div className="mx-auto flex h-[3.25rem] max-w-2xl items-stretch justify-around px-1">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <Link
                key={t.key}
                href={t.href}
                aria-current={t.active ? 'page' : undefined}
                // h-11-ish once the label is counted — comfortably past the 44px a thumb needs.
                className={cn(itemClass, t.active ? 'text-primary' : 'text-muted-foreground active:text-foreground')}
              >
                <span className="relative">
                  <Icon className="size-[22px]" strokeWidth={t.active ? 2.4 : 1.8} />
                  {t.dot ? <span className="absolute -right-1 -top-0.5 size-2 rounded-full bg-destructive ring-2 ring-card" /> : null}
                </span>
                <span className={cn('max-w-full truncate text-[11px] leading-none', t.active ? 'font-semibold' : 'font-medium')}>
                  {t.label}
                </span>
              </Link>
            );
          })}

          {/* Opens the menu, and closes it again — the icon turns into an X while it is
              open, so the way back out is the same spot the thumb just used. The label
              stays "More" rather than becoming "Close": the word is how people find this
              tab, and a label that moves is a tab that has to be re-learnt.
              Trigger when shut, Close when open, because a dialog TRIGGER only ever
              opens — tapping it again did nothing, and the menu could not be dismissed
              from the button that raised it. Both are registered with the popup, so
              neither fights the outside-press dismiss the way a plain button would. */}
          {React.createElement(
            menuOpen ? SheetClose : SheetTrigger,
            {
              render: (
                <button
                  type="button"
                  aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                  className={cn(itemClass, menuOpen ? 'text-primary' : 'text-muted-foreground active:text-foreground')}
                />
              ),
            },
            <span key="icon" className="relative">
              {menuOpen ? <X className="size-[22px]" strokeWidth={2.4} /> : <Menu className="size-[22px]" strokeWidth={1.8} />}
              {!menuOpen && moreDot ? <span className="absolute -right-1 -top-0.5 size-2 rounded-full bg-destructive ring-2 ring-card" /> : null}
            </span>,
            <span key="label" className={cn('text-[11px] leading-none', menuOpen ? 'font-semibold' : 'font-medium')}>More</span>,
          )}
        </div>
      </nav>

      {/* The full list. It stops at this bar's top edge — see mobile-sidebar.jsx. */}
      <NavDrawerContent user={user} onNavigate={() => setMenuOpen(false)} />
    </Sheet>
  );
}
