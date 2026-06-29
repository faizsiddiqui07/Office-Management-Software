'use client';

import { ThemeToggle } from '@/components/theme-toggle';
import { Brand } from './brand';
import { UserMenu } from './user-menu';
import { NotificationsBell } from './notifications-bell';
import { TopbarClock } from './topbar-clock';
import { RefreshButton } from './refresh-button';
import { MobileSidebar } from './mobile-sidebar';

export function Topbar({ user }) {
  return (
    <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6 lg:px-8">
      <div className="glass glass-highlight flex h-14 items-center justify-between gap-3 rounded-2xl px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 lg:hidden">
          <MobileSidebar user={user} />
          {/* < 500px: small square mark · 500px–lg: full wordmark logo */}
          <span className="flex shrink-0 min-[500px]:hidden">
            <Brand compact />
          </span>
          <span className="hidden min-w-0 min-[500px]:flex">
            <Brand />
          </span>
        </div>
        <div className="hidden flex-1 lg:flex lg:items-center">
          <TopbarClock />
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <RefreshButton />
          <NotificationsBell />
          <ThemeToggle />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
