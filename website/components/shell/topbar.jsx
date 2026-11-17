'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { MobileNavDrawer } from './mobile-sidebar';
import { Brand } from './brand';
import { UserMenu } from './user-menu';
import { NotificationsBell } from './notifications-bell';
import { TopbarClock } from './topbar-clock';
import { RefreshButton } from './refresh-button';
import { PointsBadge } from './points-badge';

export function Topbar({ user }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = React.useState(false);
  // The ONE screen where the bottom bar isn't there to lean on: the chat pane at phone
  // width hides it, because chat is a full-height box with its own composer pinned above
  // the keyboard and it needs every pixel (see AppShell and bottom-nav.jsx). Without this
  // button the only way off that screen would be the logo. The two are exact opposites —
  // `sm:hidden` here against `max-sm:hidden` on the bar — so a hamburger and a More tab
  // are never on screen together.
  const chatPane = pathname === '/chat' || pathname?.startsWith('/chat/');

  return (
    <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6 lg:px-8">
      <div className="glass glass-highlight flex h-14 items-center justify-between gap-3 rounded-2xl px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 lg:hidden">
          {chatPane ? (
            <>
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                aria-label="Open menu"
                aria-expanded={menuOpen}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground sm:hidden"
              >
                <Menu className="size-[18px]" />
              </button>
              <MobileNavDrawer user={user} open={menuOpen} onOpenChange={setMenuOpen} />
            </>
          ) : null}
          {/* Everywhere else the hamburger is gone. The whole nav now opens from the More tab at
              the bottom of the screen, where a thumb already is — a menu button in the
              top-left corner is the furthest point on a phone from the hand holding it.
              Keeping both would have been two doors to one room, at opposite corners.
              Owner's ask, 17 Nov 2026; the space it leaves goes to the logo. */}
          {/* Tapping the logo goes home, the way it does in the desktop sidebar — the
              only place this was missing was here, so on a phone the logo looked
              tappable and did nothing.
              < 500px: small square mark · 500px–lg: full wordmark logo */}
          <Link href="/dashboard" aria-label="Go to dashboard" className="flex min-w-0 items-center">
            <span className="flex shrink-0 min-[500px]:hidden">
              <Brand compact />
            </span>
            <span className="hidden min-w-0 min-[500px]:flex">
              <Brand size="topbar" />
            </span>
          </Link>
        </div>
        <div className="hidden flex-1 lg:flex lg:items-center">
          <TopbarClock />
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <PointsBadge />
          <RefreshButton />
          <NotificationsBell />
          {/* Phone par nahi — header me jagah bachane ke liye (owner, 31 Oct 2026).
              Theme badalne ka poora option Profile page par pehle se hai (wahan teen
              choice hain: light, dark, system), isliye yahan kuch kho nahi raha.
              Desktop par jagah ki tangi nahi, to wahan ye raha. Login/forgot-password
              wale screen ka toggle alag hai aur zaroori hai — sign-in se pehle theme
              badalne ka wahi ek raasta hai. */}
          <ThemeToggle className="hidden sm:inline-flex" />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
