'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, CircleUser, LogOut, Settings, UserPlus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { roleName, can } from '@/lib/permissions';
import { useAuth } from '@/lib/auth';
import { listAccounts } from '@/lib/accounts';

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function UserMenu({ user }) {
  const { logout, switchTo } = useAuth();
  const router = useRouter();
  const canManageSettings = can(user, 'manageSettings');

  // Other accounts remembered on this device (lib/accounts.js). Read when the menu opens,
  // not at render — localStorage isn't there on the server, and the list changes only
  // through this menu and the login page.
  const [others, setOthers] = React.useState([]);
  const onOpenChange = (open) => {
    if (open) setOthers(listAccounts().filter((a) => !a.active && a.id !== String(user.id)));
  };

  // Every account change is a hard navigation: react-query still holds the account we're
  // leaving (dashboard numbers, badges, notifications, chat), and a full load is the only
  // way to be sure none of it shows up under the other name.
  const onSwitch = (id) => {
    if (switchTo(id)) window.location.href = '/dashboard';
  };
  const onAddAccount = () => {
    window.location.href = '/login/add';
  };
  const onSignOut = async () => {
    const { next } = await logout();
    window.location.href = next ? '/dashboard' : '/login';
  };
  const onSignOutAll = async () => {
    await logout({ all: true });
    window.location.href = '/login';
  };

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-xl p-1 pr-2 text-left transition-colors hover:bg-foreground/5 focus-visible:outline-none">
        <Avatar className="size-8">
          {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name} /> : null}
          <AvatarFallback>{initialsOf(user.name)}</AvatarFallback>
        </Avatar>
        <div className="hidden text-left sm:block">
          <p className="text-sm font-medium leading-none">{user.name}</p>
          <p className="text-xs text-muted-foreground">{roleName(user)}</p>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 border-border/60 bg-card/90 ring-1 ring-white/10 backdrop-blur-2xl"
      >
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <Avatar className="size-9">
            {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
            <AvatarFallback>{initialsOf(user.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <Check className="size-4 shrink-0 text-primary" aria-label="Signed in" />
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

        {/* Account switcher — other accounts signed in on this device, one tap to switch.
            (Base UI: a label must live inside a group.) */}
        {others.length ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Switch account
            </DropdownMenuLabel>
            {others.map((acc) => (
              <DropdownMenuItem key={acc.id} onClick={() => onSwitch(acc.id)} className="gap-2.5">
                <Avatar className="size-7">
                  {acc.avatarUrl ? <AvatarImage src={acc.avatarUrl} alt="" /> : null}
                  <AvatarFallback className="text-[10px]">{initialsOf(acc.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{acc.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{acc.roleLabel || acc.email}</p>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : null}
        <DropdownMenuItem onClick={onAddAccount}>
          <UserPlus /> Add another account
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onSignOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
        {others.length ? (
          <DropdownMenuItem variant="destructive" onClick={onSignOutAll}>
            <LogOut /> Sign out of all accounts
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
