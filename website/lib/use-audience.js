'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Everyone an announcement can be addressed to.
 *
 * Deliberately not `/users`: that route is gated on `viewEveryone`, a different permission
 * from the `postAnnouncements` this dialog already requires, so a role allowed to post but
 * not to browse the directory would get a 403 and a blank picker with nothing on screen to
 * explain it. This one carries the same gate as posting.
 *
 * The payload has no avatarUrl on purpose — photos are stored as base64 data URLs of around
 * 35 KB each, so a 500-person list carrying them would be a multi-megabyte response for a
 * dropdown. The picker draws initials instead.
 *
 * Fetched once per dialog and filtered in the browser. At 500 people the whole list is about
 * 12 KB gzipped, which is cheaper than a request per keystroke and makes typing instant.
 */
export function useAudiencePeople(enabled = true) {
  return useQuery({
    queryKey: ['announcements', 'audience-people'],
    queryFn: () => api.get('/announcements/audience/people'),
    enabled,
    staleTime: 5 * 60 * 1000,
    select: (res) => res?.people ?? [],
  });
}
