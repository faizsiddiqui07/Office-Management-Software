'use client';

import * as React from 'react';
import { MessagesSquare } from 'lucide-react';
import { ChatList } from './chat-list';
import { ConversationView } from './conversation-view';
import { useOpenDirect } from '@/lib/chat';

/**
 * List + conversation, ek hi component me — aur yahi dono jagah chalta hai:
 *
 *   mode="panel"  floating button wala slide-over. Sankra hai, isliye ek waqt me EK
 *                 hi cheez: ya list, ya chat (back button ke saath) — bilkul WhatsApp
 *                 mobile jaisa.
 *   mode="page"   /chat ka poora page. Bade screen par dono saath-saath; phone par
 *                 wahi ek-ek wala bartav, kyunki jagah utni hi hai.
 *
 * Dono ek hi component share karte hain taaki panel aur page kabhi alag na ho jaayein
 * (do copies rakhte to ek me bug theek hota, doosre me reh jaata).
 */
export function ChatWindow({ mode = 'panel', initialConversationId = null, onOpenedConversation }) {
  const [active, setActive] = React.useState(
    initialConversationId ? { id: initialConversationId, peer: null } : null,
  );
  const openDirect = useOpenDirect();

  // Notification/deep-link se aayi id ko apnaa lo (?c=… badalne par bhi).
  React.useEffect(() => {
    if (initialConversationId) setActive({ id: initialConversationId, peer: null });
  }, [initialConversationId]);

  const openConversation = (c) => {
    setActive({ id: c.id, peer: c.peer });
    onOpenedConversation?.(c.id);
  };

  // "Sab log" se kisi par tap — chat pehle se ho sakti hai, ya abhi banegi.
  const openPeer = (u) => {
    openDirect.mutate(u.id, {
      onSuccess: (conv) => {
        setActive({ id: conv.id, peer: conv.peer });
        onOpenedConversation?.(conv.id);
      },
    });
  };

  const isPage = mode === 'page';

  // ── Panel: ek waqt me ek ──────────────────────────────────────────────────
  if (!isPage) {
    return active ? (
      <ConversationView
        conversationId={active.id}
        peer={active.peer}
        showBack
        onBack={() => setActive(null)}
      />
    ) : (
      <ChatList activeId={null} onOpenConversation={openConversation} onOpenPeer={openPeer} />
    );
  }

  // ── Page: bade screen par dono, phone par ek ──────────────────────────────
  return (
    <div className="flex h-full min-h-0">
      <div
        className={`w-full shrink-0 border-border/60 md:w-80 md:border-r lg:w-96 ${active ? 'hidden md:block' : 'block'}`}
      >
        <ChatList activeId={active?.id} onOpenConversation={openConversation} onOpenPeer={openPeer} />
      </div>

      <div className={`min-w-0 flex-1 ${active ? 'block' : 'hidden md:block'}`}>
        {active ? (
          <ConversationView
            conversationId={active.id}
            peer={active.peer}
            showBack
            onBack={() => setActive(null)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <MessagesSquare className="size-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Koi chat chunein</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Baayin taraf se kisi colleague par tap karein.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
