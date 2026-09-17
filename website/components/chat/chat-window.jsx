'use client';

import * as React from 'react';
import { MessagesSquare } from 'lucide-react';
import { ChatList } from './chat-list';
import { ConversationView } from './conversation-view';
import { useOpenDirect } from '@/lib/chat';

/**
 * /chat ka poora page: list + conversation.
 *
 * Bade screen par dono saath-saath; phone par ek waqt me EK — ya list, ya chat (back
 * button ke saath) — bilkul WhatsApp mobile jaisa, kyunki jagah utni hi hai.
 *
 * Pehle iska ek "panel" mode bhi tha (floating button ka slide-over). Wo hata diya —
 * floating button ab seedha is page par laata hai. Dekho chat-fab.jsx.
 */
export function ChatWindow({ initialConversationId = null, onOpenedConversation }) {
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

  // "Everyone" se kisi par tap — chat pehle se ho sakti hai, ya abhi banegi.
  const openPeer = (u) => {
    openDirect.mutate(u.id, {
      onSuccess: (conv) => {
        setActive({ id: conv.id, peer: conv.peer });
        onOpenedConversation?.(conv.id);
      },
    });
  };

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
              <p className="text-sm font-medium">Select a chat</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick a colleague from the list on the left.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
