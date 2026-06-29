'use client';

import * as React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Megaphone, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/glass/status-badge';
import { PRIORITY, formatDateTime } from '@/lib/announcement';

/**
 * Shown once per session after login: steps through announcements the user
 * hasn't dismissed. Each "Next/Got it" marks the current one read so it never
 * pops again (it still lives in the feed).
 */
export function AnnouncementPopup() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['announcements', 'active-unseen'],
    queryFn: () => api.get('/announcements/active-unseen'),
    enabled: !!user,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const [queue, setQueue] = React.useState(null);
  const [idx, setIdx] = React.useState(0);
  const markRead = useMutation({ mutationFn: (id) => api.post(`/announcements/${id}/read`) });

  React.useEffect(() => {
    if (queue === null && data?.announcements) {
      setQueue(data.announcements);
      setIdx(0);
    }
  }, [data, queue]);

  const open = !!queue && idx < queue.length;
  const current = open ? queue[idx] : null;

  const advance = () => {
    if (current) markRead.mutate(current.id);
    setIdx((i) => i + 1);
  };

  if (!current) return null;

  const p = PRIORITY[current.priority] ?? PRIORITY.NORMAL;
  const isUrgent = current.priority === 'URGENT';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) advance(); }}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'border bg-card/90 shadow-glass ring-1 backdrop-blur-2xl sm:max-w-lg',
          isUrgent ? 'border-destructive/40 ring-destructive/20' : 'border-border/60 ring-white/10',
        )}
      >
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-xl ring-1',
                isUrgent ? 'bg-destructive/12 text-destructive ring-destructive/25' : 'bg-primary/12 text-primary ring-primary/25',
              )}
            >
              {isUrgent ? <TriangleAlert className="size-5" /> : <Megaphone className="size-5" />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={p.tone} dot={false}>
                  {p.label}
                </StatusBadge>
                <span className="text-xs text-muted-foreground">
                  {current.createdBy?.name ?? 'Leadership'} · {formatDateTime(current.createdAt)}
                </span>
              </div>
              <DialogTitle className="mt-1 text-lg">{current.title}</DialogTitle>
            </div>
          </div>
          {current.body ? (
            <DialogDescription className="mt-2 max-h-[50vh] overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-foreground/80">
              {current.body}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <span className="mr-auto self-center text-xs text-muted-foreground">
            {idx + 1} of {queue.length}
          </span>
          <Button onClick={advance}>{idx < queue.length - 1 ? 'Next' : 'Got it'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
