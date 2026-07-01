'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navItemsFor } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { Brand } from './brand';

export function AppSidebar({ user }) {
  const pathname = usePathname();
  const items = navItemsFor(user);

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col p-4 lg:flex">
      <div className="glass glass-highlight flex h-full flex-col rounded-3xl p-4">
        <Link href="/dashboard" className="px-1">
          <Brand />
        </Link>

        <nav className="mt-7 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
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
    </aside>
  );
}
