'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Clock, Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { AppDialog } from '@/components/glass/app-dialog';
import { formatDateTime } from '@/lib/announcement';

/**
 * "Seen by X of Y" on an announcement, for the author — so they know who still needs to
 * see it and can chase them. Only mounted for people who can post announcements (the feed
 * gates it); the endpoint is `postAnnouncements`-only too.
 */
export function AnnouncementReceipts({ announcementId }) {
  const [open, setOpen] = React.useState(false);
  const { data } = useQuery({
    queryKey: ['announcement-reads', announcementId],
    queryFn: () => api.get(`/announcements/${announcementId}/reads`),
  });

  if (!data) return null;
  const { total, seenCount, seen, unseen } = data;
  // Nobody but the author is addressed (e.g. an owner-only post) — no receipts to show.
  if (total === 0) return null;

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      title="Read receipts"
      trigger={
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Eye className="size-3.5" /> Seen by {seenCount} of {total}
        </button>
      }
    >
      <div className="max-h-[60vh] space-y-4 overflow-y-auto py-1">
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Seen · {seen.length}</p>
          {seen.length ? (
            <ul className="space-y-1.5">
              {seen.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 shrink-0 text-success" /> {s.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(s.readAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No one has opened it yet.</p>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Not seen yet · {unseen.length}</p>
          {unseen.length ? (
            <ul className="space-y-1.5">
              {unseen.map((u, i) => (
                <li key={i} className="flex items-center gap-1.5 text-sm text-muted-foreground"><Clock className="size-3.5 shrink-0" /> {u.name}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-success">Everyone has seen it.</p>
          )}
        </div>
      </div>
    </AppDialog>
  );
}
