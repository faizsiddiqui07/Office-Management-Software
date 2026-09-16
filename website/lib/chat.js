'use client';

import * as React from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useChatRealtime } from '@/components/chat/chat-realtime';

/**
 * Chat ke saare data hooks.
 *
 * Naya message WebSocket se aata hai (lib/chat-socket.js). Polling ab sirf FALLBACK hai:
 * jab tak socket live hai, har interval BAND rehta hai; socket toote ya WebSocket abhi
 * set hi na hua ho, to polling apne aap sambhal leti hai. `useChatRealtime()` ka
 * `connected` hi ye switch hai.
 *
 * Ye farak sirf saholat ka nahi, paise ka hai: 3-second polling 100 users par ~INR 3,233
 * mahina padti hai aur free database tier ki 100-operations/second wali deewar ~81 users
 * par hi tod deti hai; WebSocket wahi kaam ~INR 89 me karta hai.
 */

const LIST_KEY = ['chat', 'conversations'];
const UNREAD_KEY = ['chat', 'unread'];
const msgKey = (id) => ['chat', 'messages', id];

/** Floating button ka badge. */
export function useChatUnread() {
  const { connected } = useChatRealtime();
  const { data } = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: () => api.get('/chat/unread'),
    staleTime: 20_000,
    refetchInterval: connected ? false : 60_000,
    refetchOnWindowFocus: true,
  });
  return data?.unread ?? 0;
}

/** Meri chat list, naye message wali sabse upar. */
export function useConversations(enabled = true) {
  const { connected } = useChatRealtime();
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: () => api.get('/chat/conversations'),
    enabled,
    staleTime: 10_000,
    refetchInterval: enabled && !connected ? 30_000 : false,
    refetchOnWindowFocus: true,
  });
}

/** Har wo colleague jisse baat ho sakti hai. */
export function useContacts(enabled = true) {
  return useQuery({
    queryKey: ['chat', 'contacts'],
    queryFn: () => api.get('/chat/contacts'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/**
 * Ek chat ka itihaas, page-dar-page peeche ki taraf.
 *
 * Server naya-se-purana bhejta hai par ek page ke andar purana→naya; is liye render
 * karte waqt pages ko ULTA jodna padta hai (aakhri page sabse purana hai).
 */
export function useMessages(conversationId, { live = true } = {}) {
  const { connected } = useChatRealtime();
  const q = useInfiniteQuery({
    queryKey: msgKey(conversationId),
    enabled: !!conversationId,
    queryFn: ({ pageParam }) =>
      api.get(`/chat/conversations/${conversationId}/messages${pageParam ? `?before=${pageParam}` : ''}`),
    initialPageParam: null,
    getNextPageParam: (last) => (last?.hasMore ? last.messages[0]?.seq ?? null : null),
    staleTime: 2_000,
    // Socket live hai to poll ki zaroorat hi nahi — naya message khud aa jaata hai.
    refetchInterval: live && !connected ? 5_000 : false,
    refetchOnWindowFocus: true,
  });

  const messages = React.useMemo(() => {
    const pages = q.data?.pages ?? [];
    // pages[0] sabse naya page hai → ulta karke purana-se-naya banao
    return [...pages].reverse().flatMap((p) => p.messages ?? []);
  }, [q.data]);

  // Conversation ki header info (peer, ticks) hamesha SABSE NAYE page se — wahi taaza hai.
  const conversation = q.data?.pages?.[0]?.conversation ?? null;

  return { ...q, messages, conversation };
}

/** Kisi colleague ke saath chat kholo (ya bana do). */
export function useOpenDirect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (peerId) => api.post('/chat/conversations', { peerId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

/**
 * Message bhejo — optimistic.
 *
 * Bubble turant dikh jaata hai (ghadi ke nishaan ke saath), phir server ka asli message
 * uski jagah le leta hai. Fail hone par optimistic bubble hata dete hain aur error
 * bubble aata hai — chupchap gayab hona sabse bura hota, kyunki bhejne wale ko lagta
 * hai message chala gaya.
 */
export function useSendMessage(conversationId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ text, replyToSeq }) =>
      api.post(`/chat/conversations/${conversationId}/messages`, { text, replyToSeq }),
    onMutate: async ({ text, replyToSeq, replyPreview }) => {
      await qc.cancelQueries({ queryKey: msgKey(conversationId) });
      const prev = qc.getQueryData(msgKey(conversationId));
      const temp = {
        id: `temp-${Date.now()}`,
        seq: Number.MAX_SAFE_INTEGER, // hamesha sabse neeche rahe jab tak asli na aa jaye
        mine: true,
        kind: 'TEXT',
        text,
        pending: true,
        replyTo: replyToSeq ? { seq: replyToSeq, mine: false, text: replyPreview || '' } : null,
        createdAt: new Date().toISOString(),
      };
      qc.setQueryData(msgKey(conversationId), (old) => {
        if (!old?.pages?.length) return old;
        const pages = [...old.pages];
        pages[0] = { ...pages[0], messages: [...pages[0].messages, temp] };
        return { ...old, pages };
      });
      return { prev, tempId: temp.id };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(msgKey(conversationId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: msgKey(conversationId) });
      qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

/** "Maine yahan tak padh liya" — unread 0, aur saamne wale ko blue tick. */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, upToSeq }) =>
      api.post(`/chat/conversations/${conversationId}/read`, { upToSeq }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: UNREAD_KEY });
      qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

/** Sirf mere liye chhupao — saamne wale ke paas raha rahega. */
export function useDeleteMessage(conversationId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId) => api.delete(`/chat/messages/${messageId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: msgKey(conversationId) });
      qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

/** Is chat ki ghanti band / chaalu. */
export function useSetMuted(conversationId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (until) => api.post(`/chat/conversations/${conversationId}/mute`, { until }),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

// ── chhote helpers ────────────────────────────────────────────────────────────
export function chatInitials(name = '') {
  return (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** Chat list ka time: aaj = 10:42, kal = "Kal", usse purana = 14 Sep. */
export function chatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Kal';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Bubble ke beech ka din ka chip. */
export function dayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Aaj';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Kal';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
