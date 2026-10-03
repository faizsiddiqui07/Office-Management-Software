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
      {isLeader ? (
        <div className="flex justify-end">
          <CreateAnnouncementDialog />
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : list.length ? (
        list.map((a) => (
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
