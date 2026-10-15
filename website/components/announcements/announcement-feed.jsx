'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ellipsis, Megaphone, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { AnnouncementCard } from './announcement-card';
import { AnnouncementReceipts } from './announcement-receipts';
import { CreateAnnouncementDialog } from './create-announcement-dialog';
import { EmptyState } from '@/components/glass/empty-state';
import { CardSkeleton } from '@/components/glass/skeletons';
import { ConfirmDialog } from '@/components/glass/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SortSelect, sortRows, byText, byTime, thenBy } from '@/components/glass/sort-select';

// Urgent above Important above Normal. Mirrors lib/announcement.js's PRIORITY.
const PRIORITY_RANK = { URGENT: 3, IMPORTANT: 2, NORMAL: 1 };

/**
 * The feed's own date is `announcedAt` — when a post LAST went out, which for a
 * repeating one is nothing like when it was written. Sorting on createdAt would
 * sink a post that went out this morning below one nobody has seen since August,
 * so every date option here reads announcedAt first and only falls back.
 */
const FEED_SORTS = [
  { value: 'newest', label: 'Newest first', compare: byTime((a) => a.announcedAt || a.createdAt) },
  { value: 'oldest', label: 'Oldest first', compare: byTime((a) => a.announcedAt || a.createdAt, 'asc') },
  {
    value: 'priority',
    label: 'Urgent first',
    compare: thenBy(
      (a, b) => (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0),
      byTime((a) => a.announcedAt || a.createdAt),
    ),
  },
  { value: 'title', label: 'Title A–Z', compare: thenBy(byText((a) => a.title), byTime((a) => a.announcedAt || a.createdAt)) },
];

export function AnnouncementFeed() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isLeader = !!user && can(user, 'postAnnouncements');

  const { data, isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api.get('/announcements'),
  });
  const list = data?.announcements ?? [];

  const [editing, setEditing] = React.useState(null);
  const [deleting, setDeleting] = React.useState(null);
  // Starts on the server's own order (last announced first), so opening the page
  // shows exactly what it always did.
  const [sort, setSort] = React.useState('newest');
  const rows = sortRows(list, FEED_SORTS, sort);

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/announcements/${id}`),
    onSuccess: () => {
      toast.success('Announcement deleted');
      // Its bells go with it, so the notification list is stale too.
      qc.invalidateQueries({ queryKey: ['announcements'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      setDeleting(null);
    },
    onError: (e) => toast.error(e?.message || 'Could not delete'),
  });

  return (
    <div className="space-y-4">
      {/* One toolbar row: sorting on the left, posting on the right. The sort
          control stays away until there are two posts to put in an order. */}
      {list.length > 1 || isLeader ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {list.length > 1 ? (
            <SortSelect value={sort} onChange={setSort} options={FEED_SORTS} ariaLabel="Sort announcements" />
          ) : (
            <span />
          )}
          {isLeader ? <CreateAnnouncementDialog /> : null}
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : rows.length ? (
        rows.map((a) => (
          <AnnouncementCard
            key={a.id}
            announcement={a}
            receipts={isLeader ? <AnnouncementReceipts announcementId={a.id} summary={a.reads} /> : null}
            actions={
              isLeader ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
                    <Ellipsis className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="border-border/60 bg-card/90 ring-1 ring-white/10 backdrop-blur-2xl">
                    <DropdownMenuItem onClick={() => setEditing(a)}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleting(a)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null
            }
          />
        ))
      ) : (
        <EmptyState
          icon={Megaphone}
          title="No announcements"
          description={isLeader ? 'Post the first announcement for your team.' : "You're all caught up."}
        />
      )}

      {editing ? (
        <CreateAnnouncementDialog
          announcement={editing}
          open={!!editing}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete this announcement?"
        description={
          deleting
            ? `"${deleting.title}" will be deleted for good, along with who has read it and the notifications it sent. This can't be undone.`
            : ''
        }
        tone="destructive"
        confirmLabel="Delete"
        loading={deleteMut.isPending}
        onConfirm={() => deleting && deleteMut.mutate(deleting.id)}
      />
    </div>
  );
}
