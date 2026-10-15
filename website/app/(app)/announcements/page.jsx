import { Megaphone } from 'lucide-react';
import { PageHeader } from '@/components/glass/page-header';
import { AnnouncementFeed } from '@/components/announcements/announcement-feed';

export default function AnnouncementsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Announcements"
        title="Announcements"
        icon={Megaphone}
        // No "newest first" here any more: the feed can be re-sorted now, so a
        // fixed claim about the order would be wrong half the time.
        description="Notices from leadership."
      />
      <AnnouncementFeed />
    </div>
  );
}
