'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useChatSocket } from '@/lib/chat-socket';
import { markDeletedInCache } from '@/lib/chat';
import { useAuth } from '@/lib/auth';
import { mergeIncomingMessage, applyPeerRead } from '@/lib/chat-cache';

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
        // Apna bheja message ho to uske temporary bubble ko usi jagah badla jaata hai — dekho
        // lib/chat-cache.js (pehle yahan sirf `seq` se milaan tha, aur do bubble dikhte the).
        qc.setQueryData(key, (old) => mergeIncomingMessage(old, ev.message, myId));
        qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
        qc.invalidateQueries({ queryKey: ['chat', 'unread'] });
        return;
      }

      if (ev.type === 'chat:read') {
        // Saamne wale ne padh liya → mere bubbles ke tick neele. Naamumkin number (jaise
        // temporary bubble ka MAX) chhod diya jaata hai, dekho lib/chat-cache.js applyPeerRead.
        const key = ['chat', 'messages', ev.conversationId];
        const { data, backward } = applyPeerRead(qc.getQueryData(key), ev.upToSeq);
        if (data !== qc.getQueryData(key)) qc.setQueryData(key, data);
        // Cache me purane bug ka MAX pada tha aur server ne theek number bheja. Cache wala
        // number hi jhootha hai (jhoothe neele tick), to server se taaza mangao.
        if (backward) qc.invalidateQueries({ queryKey: key });
        qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
        return;
      }

      if (ev.type === 'chat:deleted') {
        // Bhejne wale ne "delete for everyone" kiya → bubble usi pal tombstone. Ye event
        // zaroori hai: reconnect wali bharpai sirf NAYE seq laati hai, purane message ka
        // badlaav usse kabhi nahi aata.
        markDeletedInCache(qc, ev.conversationId, ev.messageId);
        // Aur invalidate bhi: agar is chat ka koi fetch (purana page / refetch) abhi udaan
        // me hai, to uska jawab fetch-shuru wale snapshot se cache likh deta hai aur upar
        // wala tombstone mit jaata hai. invalidate us fetch ko radd karke taaza laata hai.
        qc.invalidateQueries({ queryKey: ['chat', 'messages', ev.conversationId] });
        qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      }
    },
    [qc, myId],
  );

  const { connected } = useChatSocket({ activeConversationId, onMessage });
  const value = React.useMemo(() => ({ connected, setActive }), [connected]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
