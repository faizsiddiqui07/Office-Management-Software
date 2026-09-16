'use client';

import { useSearchParams } from 'next/navigation';
import { MessagesSquare } from 'lucide-react';
import { PageHeader } from '@/components/glass/page-header';
import { GlassCard } from '@/components/glass/glass-card';
import { ChatWindow } from '@/components/chat/chat-window';

/**
 * Poora chat page — laptop par asli kaam ki jagah, aur notification par tap karne ki
 * landing. `?c=<id>` seedha usi chat par khol deta hai (push notification wahi bhejta
 * hai), warna list khulti hai.
 *
 * Height `dvh` me hai, `vh` me nahi: phone ke browser me address bar chhupte-dikhte waqt
 * `vh` nahi badalta, jiski wajah se composer screen ke neeche chala jaata hai.
 */
export default function ChatPage() {
  const conversationId = useSearchParams().get('c');

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Chat"
        title="Chat"
        icon={MessagesSquare}
        description="Apne colleagues se seedhi baat. Aapki chat sirf aap dono dekh sakte hain."
      />
      <GlassCard className="h-[calc(100dvh-16rem)] min-h-[440px] overflow-hidden p-0">
        <ChatWindow mode="page" initialConversationId={conversationId} />
      </GlassCard>
    </div>
  );
}
