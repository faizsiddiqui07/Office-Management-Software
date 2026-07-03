'use client';

import { useRouter } from 'next/navigation';
import { CircleUser, LogOut, Settings } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { roleName, can } from '@/lib/permissions';
import { useAuth } from '@/lib/auth';

export function UserMenu({ user }) {
  const { logout } = useAuth();
  const router = useRouter();
  const canManageSettings = can(user, 'manageSettings');

  const initials = (user.name || '?')
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const onSignOut = async () => {
    await logout();
    // Hard navigation — fully resets app + react-query state so there's no
    // chance of bouncing back to the dashboard.
    window.location.href = '/login';
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-xl p-1 pr-2 text-left transition-colors hover:bg-foreground/5 focus-visible:outline-none">
        <Avatar className="size-8">
          {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name} /> : null}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="hidden text-left sm:block">
          <p className="text-sm font-medium leading-none">{user.name}</p>
          <p className="text-xs text-muted-foreground">{roleName(user)}</p>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 border-border/60 bg-card/90 ring-1 ring-white/10 backdrop-blur-2xl"
      >
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium text-foreground">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push('/profile')}>
          <CircleUser /> Profile
        </DropdownMenuItem>
        {canManageSettings ? (
          <DropdownMenuItem onClick={() => router.push('/settings')}>
            <Settings /> Company settings
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onSignOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
