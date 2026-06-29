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
        description="Notices from leadership — newest first."
      />
      <AnnouncementFeed />
    </div>
  );
}
