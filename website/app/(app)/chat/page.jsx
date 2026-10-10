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
 * Ab height HAR size par `useViewportFill` se naapi jaati hai, nap-tol se nahi. Chhoti
 * screen par iske saath header chhupa hua hai aur card kinare se kinare tak hai, aur
 * shell ka padding/footer is route par hat jaate hain (dekho app-shell.jsx ka `appPane`) —
 * to pane topbar ke theek neeche se screen ke ant tak jaata hai.
 *
 * `sm` se upar header aur footer jaise the waise hi rehte hain; wahan hook unki jagah
 * `reserve` se chhod deta hai. Ye wahi cheez thi jo 768px par bhi composer ko 5px kaat
 * rahi thi — kyunki `100dvh − 16rem` ek anumaan tha, aur anumaan har breakpoint par
 * galat nikalta hai.
 */
export default function ChatPage() {
  const conversationId = useSearchParams().get('c');
  const paneRef = useViewportFill({
    // `sm` se upar footer aur main ka neeche wala padding is pane ke NEECHE rehte hain.
    // Unki jagah chhodni zaroori hai, warna pane unhe fold ke neeche dhakel deta hai aur
    // page phir se scroll karne lagta hai — 768px par yahi composer ko 5px kaat raha tha.
    // Phone par footer `display:none` hai aur padding 0, to yahan apne aap 0 aa jaata hai.
    reserve: (el) => {
      let px = 0;
      const footer = document.querySelector('footer');
      if (footer && getComputedStyle(footer).display !== 'none') {
        px += footer.getBoundingClientRect().height;
      }
      const main = el.closest('main');
      if (main) px += parseFloat(getComputedStyle(main).paddingBottom) || 0;
      return px;
    },
  });

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
      {/* Yahan ki height sirf PEHLE frame ke liye hai — hook turant isko naapi hui height
          se badal deta hai. `min-h` jaan-bujhkar nahi hai: wo inline height ko neeche se
          dhakel kar page ko dobara scroll karwa deta, jo poora masla hi tha. Chhoti se
          chhoti height ki hifazat hook ke apne `min` me hai. */}
      <div ref={paneRef} className="h-[calc(100dvh-4.5rem)] sm:h-[calc(100dvh-16rem)]">
        <GlassCard className="h-full overflow-hidden rounded-none p-0 sm:rounded-2xl">
          <ChatWindow initialConversationId={conversationId} />
        </GlassCard>
      </div>
    </div>
  );
}
