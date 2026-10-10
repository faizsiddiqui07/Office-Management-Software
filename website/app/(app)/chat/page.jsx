'use client';

import { useSearchParams } from 'next/navigation';
import { MessagesSquare } from 'lucide-react';
import { PageHeader } from '@/components/glass/page-header';
import { GlassCard } from '@/components/glass/glass-card';
import { ChatWindow } from '@/components/chat/chat-window';
import { useViewportFill } from '@/lib/use-viewport-fill';

/**
 * Poora chat page — laptop par asli kaam ki jagah, aur notification par tap karne ki
 * landing. `?c=<id>` seedha usi chat par khol deta hai (push notification wahi bhejta
 * hai), warna list khulti hai.
 *
 * PHONE PAR YE PAGE NAHI, APP JAISI SCREEN HAI. Pehle yahan page ka header, uske neeche
 * ek nap-tol kar rakhi hui height (`100dvh − 16rem`), aur sabse neeche shell ka
 * "ManagiBot | A product of BrainQbit" footer — teenon ek saath. Phone par unka jod
 * screen se zyada ho jaata tha, to page khud scroll karne lagta tha aur composer neeche
 * kat jaata tha; keyboard khulte hi uske saath footer bhi jhaank aata tha.
 *
 * Ab chhoti screen par: header chhupa hua, card kinare se kinare tak, aur height
 * `useViewportFill` se naapi hui — topbar ke theek neeche se wahan tak jahan asli dikhne
 * wali screen khatam hoti hai. Page ke paas scroll karne ko kuch bachta hi nahi, isliye
 * composer hamesha apni jagah par rehta hai. Shell ka padding aur footer is route par
 * hat jaate hain — dekho app-shell.jsx ka `appPane`.
 *
 * `sm` se upar sab kuch bilkul pehle jaisa hai: hook wahan inline height lagata hi nahi.
 */
export default function ChatPage() {
  const conversationId = useSearchParams().get('c');
  // Hook chalne se pehle ka pehla frame: topbar (pt-4 + h-14 = 4.5rem) ghata hua —
  // taaki shuru me kuch jhatka na dikhe. Uske baad asli naap isi ko badal deti hai.
  const paneRef = useViewportFill();

  return (
    <div className="sm:space-y-6">
      <div className="hidden sm:block">
        <PageHeader
          eyebrow="Chat"
          title="Chat"
          icon={MessagesSquare}
          description="Direct messages with your colleagues. Only the two of you can see a chat."
        />
      </div>
      <div ref={paneRef} className="h-[calc(100dvh-4.5rem)] sm:h-[calc(100dvh-16rem)] sm:min-h-[440px]">
        <GlassCard className="h-full overflow-hidden rounded-none p-0 sm:rounded-2xl">
          <ChatWindow initialConversationId={conversationId} />
        </GlassCard>
      </div>
    </div>
  );
}
