'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDateTime } from '@/lib/announcement';

export function NotificationsBell() {
  const qc = useQueryClient();
  const router = useRouter();

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications'),
    refetchInterval: 60000,
  });
  const notifications = data?.notifications ?? [];
  const unread = data?.unread ?? 0;

  const markRead = useMutation({
    mutationFn: (id) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const onClickItem = (n) => {
    if (!n.isRead) markRead.mutate(n.id);
    if (n.link) router.push(n.link);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="glass-subtle relative inline-flex size-8 items-center justify-center rounded-xl text-foreground/80 ring-1 ring-border/60 transition-colors hover:text-foreground">
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground ring-2 ring-background">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[calc(100vw-2rem)] max-w-80 border-border/60 bg-card/90 p-0 ring-1 ring-white/10 backdrop-blur-2xl sm:w-80"
      >
        <div className="flex items-center justify-between px-3 py-2.5">
          <p className="text-sm font-medium">Notifications</p>
          {unread > 0 ? (
            <button
              type="button"
              onClick={() => markAll.mutate()}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          ) : null}
        </div>
        <div className="max-h-80 overflow-y-auto border-t border-border/60">
          {notifications.length ? (
            notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onClickItem(n)}
                className={cn(
                  'flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-foreground/5',
                  !n.isRead && 'bg-primary/[0.04]',
                )}
              >
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.isRead ? 'bg-transparent' : 'bg-primary')} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{n.title}</p>
                  {n.message ? <p className="truncate text-xs text-muted-foreground">{n.message}</p> : null}
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{formatDateTime(n.createdAt)}</p>
                </div>
              </button>
            ))
          ) : (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">No notifications yet</div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
