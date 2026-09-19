'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { WS_TICKET_KEY } from '@/lib/auth';

/**
 * Chat ka live connection.
 *
 * Teen cheezein is file ko zaroori banati hain, aur teeno API Gateway ki sakht limits se
 * aati hain (jo badhai NAHI ja sakti):
 *
 *  1. Koi bhi connection 2 GHANTE se zyada zinda nahi rehta — chahe kitna hi vyast ho.
 *  2. 10 MINUTE khaali rehne par kat jaata hai.
 *  3. Isliye connection TOOTEGA — ye apwaad nahi, rozmarra hai.
 *
 * Matlab: sirf "socket par jo aaya wo dikha do" likhna hi sabse bada bug hota. Jab tak
 * connection toota rehta hai, us beech ke message socket par kabhi nahi aate. Isliye
 * DOBARA judte hi hum BHARPAI karte hain — chat list dobara maangte hain aur khuli chat
 * ke `after=<aakhri seq>` wale message. Iske bina message chupchap gayab hote: na error,
 * na retry.
 *
 * Aur agar WebSocket abhi set hi nahi hai (server `enabled: false` kehta hai), to ye
 * chup-chaap haar maan leta hai aur app polling par chalti rehti hai — kuch toot-ta nahi.
 */

// 10-minute idle timeout se aaram se pehle. 8 minute rakha hai taaki ek ping chhoot bhi
// jaye to doosra waqt par pahunch jaye.
const PING_MS = 8 * 60 * 1000;
// Bar-bar judne ki koshish par backoff — warna server down hone par saare browser milkar
// use aur peet dete hain.
const BACKOFF = [1000, 2000, 5000, 10000, 20000, 30000];

export function useChatSocket({ activeConversationId = null, onMessage } = {}) {
  const qc = useQueryClient();
  const [connected, setConnected] = React.useState(false);

  const socketRef = React.useRef(null);
  const pingRef = React.useRef(null);
  const retryRef = React.useRef(0);
  const closedRef = React.useRef(false);
  const activeRef = React.useRef(activeConversationId);
  const onMessageRef = React.useRef(onMessage);

  activeRef.current = activeConversationId;
  onMessageRef.current = onMessage;

  // Dobara judne par bharpai: list + khuli chat ke chhoote hue message.
  const catchUp = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    qc.invalidateQueries({ queryKey: ['chat', 'unread'] });
    if (activeRef.current) qc.invalidateQueries({ queryKey: ['chat', 'messages', activeRef.current] });
  }, [qc]);

  React.useEffect(() => {
    closedRef.current = false;
    let cancelled = false;

    const clearPing = () => {
      if (pingRef.current) clearInterval(pingRef.current);
      pingRef.current = null;
    };

    async function connect() {
      if (cancelled || closedRef.current) return;
      let info;
      try {
        // Bootstrap ke saath ek parchi aayi thi — 60 s me chalti hai, to pehli baar
        // judne me wahi kaam aati hai (ek request bachi). Ek hi baar: nikaal kar hata do,
        // taaki reconnect hamesha taazi le.
        const seeded = qc.getQueryData(WS_TICKET_KEY);
        qc.removeQueries({ queryKey: WS_TICKET_KEY, exact: true });
        info = seeded && Date.now() - (seeded.fetchedAt || 0) < 45_000 ? seeded : await api.get('/chat/ws-ticket');
      } catch {
        return; // login nahi, ya server naraz — polling chalti rahegi
      }
      if (cancelled || !info?.enabled || !info.url || !info.ticket) return;

      let ws;
      try {
        ws = new WebSocket(`${info.url}?ticket=${encodeURIComponent(info.ticket)}`);
      } catch {
        return;
      }
      socketRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { ws.close(); return; }
        retryRef.current = 0;
        setConnected(true);
        // Judte hi do kaam: server ko batao kaun si chat khuli hai, aur bharpai karo.
        ws.send(JSON.stringify({ type: 'open', conversationId: activeRef.current }));
        catchUp();
        clearPing();
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', conversationId: activeRef.current }));
          }
        }, PING_MS);
      };

      ws.onmessage = (e) => {
        let ev;
        try {
          ev = JSON.parse(e.data);
        } catch {
          return;
        }
        onMessageRef.current?.(ev);
      };

      const reconnect = () => {
        setConnected(false);
        clearPing();
        if (cancelled || closedRef.current) return;
        const wait = BACKOFF[Math.min(retryRef.current, BACKOFF.length - 1)];
        retryRef.current += 1;
        setTimeout(connect, wait);
      };

      ws.onclose = reconnect;
      ws.onerror = () => ws.close();
    }

    connect();

    // Tab wapas saamne aate hi ek bharpai — background me browser timer dabata hai aur
    // laptop so jaane par connection chup-chap mar chuka hota hai.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (socketRef.current?.readyState === WebSocket.OPEN) catchUp();
      else { retryRef.current = 0; connect(); }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      closedRef.current = true;
      document.removeEventListener('visibilitychange', onVisible);
      clearPing();
      const ws = socketRef.current;
      socketRef.current = null;
      if (ws) { ws.onclose = null; ws.close(); }
      setConnected(false);
    };
  }, [catchUp]);

  // Chat badalte hi server ko batao — isi se tay hota hai ki uska push bhejna hai ya nahi.
  React.useEffect(() => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'open', conversationId: activeConversationId }));
    }
  }, [activeConversationId]);

  return { connected };
}
