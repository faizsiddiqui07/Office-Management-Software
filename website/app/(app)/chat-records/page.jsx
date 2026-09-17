'use client';

import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/glass/page-header';
import { EmptyState } from '@/components/glass/empty-state';
import { ChatRecords } from '@/components/chat/chat-records';

/**
 * Sirf CEO & President — kisi employee ki chat nikalne ki jagah.
 *
 * Asli taala server par hai (chatAdmin.service me role ki jaanch); yahan ka check sirf
 * isliye hai ki galti se URL type karne wale ko khaali ya toota hua page na mile. Client
 * ka check kabhi suraksha nahi hota — wo sirf shistachar hai.
 */
export default function ChatRecordsPage() {
  const { user } = useAuth();

  if (!user?.isOwner) {
    return (
      <div className="py-16">
        <EmptyState
          icon={ShieldCheck}
          title="Only the CEO & President can view this"
          description="Only they are allowed to open another person's chat."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Chat records"
        title="Chat records"
        icon={ShieldCheck}
        description="Look up any employee's conversations."
      />
      <ChatRecords />
    </div>
  );
}
