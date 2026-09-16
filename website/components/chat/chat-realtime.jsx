'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useChatSocket } from '@/lib/chat-socket';
import { useAuth } from '@/lib/auth';

/**
 * Live chat ka ek hi connection, poore app ke liye.
 *
 * Ye `AppShell` me baithta hai, chat ke andar nahi — kyunki naya message ka pata tab bhi
 * chalna chahiye jab chat band ho (floating button ka badge isi se zinda rehta hai). Agar
 * ise ChatFab ke andar rakh dete to /chat page par (jahan FAB chhupta hai) connection hi
 * mar jaata.
 *
 * Yahan se do cheezein milti hain:
 *   connected  — live hai ya nahi. Jab live hai to polling BAND ho jaati hai; jab nahi
 *                (ya WebSocket abhi set hi nahi hua), polling hi chalti rehti hai.
 *   setActive  — konsi chat is waqt saamne khuli hai. Server isi se tay karta hai ki
 *                uska push bhejna hai ya nahi.
 */
const Ctx = React.createContext({ connected: false, setActive: () => {} });

export function useChatRealtime() {
  return React.useContext(Ctx);
}

export function ChatRealtimeProvider({ children }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const myId = user?.id ? String(user.id) : null;
  const [activeConversationId, setActive] = React.useState(null);

  const onMessage = React.useCallback(
    (ev) => {
      if (!ev?.type) return;

      if (ev.type === 'chat:message') {
        const key = ['chat', 'messages', ev.conversationId];
        qc.setQueryData(key, (old) => {
          if (!old?.pages?.length) return old; // ye chat abhi kholi hi nahi — list refresh kaafi hai
          const m = ev.message;
          // Ho sakta hai ye message pehle se ho: apna hi bheja hua (server ka jawab pehle
          // aa gaya), ya reconnect ki bharpai ise la chuki ho. seq se pehchano.
          if (old.pages.some((p) => p.messages?.some((x) => x.seq === m.seq))) return old;
          const pages = [...old.pages];
          // Server dono taraf ek hi event bhejta hai, isliye "mera hai ya nahi" client
          // hi tay karta hai — apne id se milaa kar.
          const mine = !!myId && String(m.sender) === myId;
          pages[0] = {
            ...pages[0],
            messages: [
              ...pages[0].messages,
              {
                id: m.id,
                seq: m.seq,
                mine,
                sender: m.sender,
                kind: m.kind,
                text: m.text,
                replyTo: m.replyTo ? { seq: m.replyTo.seq, mine: false, text: m.replyTo.text } : null,
                createdAt: m.createdAt,
              },
            ],
          };
          return { ...old, pages };
        });
        qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
        qc.invalidateQueries({ queryKey: ['chat', 'unread'] });
        return;
      }

      if (ev.type === 'chat:read') {
        // Saamne wale ne padh liya → mere bubbles ke tick neele.
        qc.setQueryData(['chat', 'messages', ev.conversationId], (old) => {
          if (!old?.pages?.length) return old;
          const pages = old.pages.map((p, i) =>
            i === 0 && p.conversation
              ? {
                  ...p,
                  conversation: {
                    ...p.conversation,
                    peerReadUpToSeq: Math.max(p.conversation.peerReadUpToSeq || 0, ev.upToSeq || 0),
                    peerDeliveredUpToSeq: Math.max(p.conversation.peerDeliveredUpToSeq || 0, ev.upToSeq || 0),
                  },
                }
              : p,
          );
          return { ...old, pages };
        });
        qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      }
    },
    [qc, myId],
  );

  const { connected } = useChatSocket({ activeConversationId, onMessage });
  const value = React.useMemo(() => ({ connected, setActive }), [connected]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
