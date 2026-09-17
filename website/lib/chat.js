'use client';

import * as React from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useChatRealtime } from '@/components/chat/chat-realtime';
import { shrinkImage, makeImageThumb, makeVideoThumb, uploadToS3, isImage, isVideo } from '@/lib/chat-media';

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

/**
 * Message hatao — do tarah se, WhatsApp jaisa:
 *   scope 'me'        → sirf meri nazar se; saamne wale ke paas raha rahega
 *   scope 'everyone'  → sirf apna bheja hua; dono taraf "This message was deleted"
 *
 * Cache turant badalta hai (optimistic) taaki tap par bubble usi pal jaaye/badle —
 * server se jawab aane tak ka intezaar phone par sust lagta hai. Fail ho to wapas.
 */
export function useDeleteMessage(conversationId) {
  const qc = useQueryClient();
  const key = msgKey(conversationId);
  return useMutation({
    mutationFn: ({ id, scope = 'me' }) =>
      api.delete(`/chat/messages/${id}${scope === 'everyone' ? '?scope=everyone' : ''}`),
    onMutate: async ({ id, scope = 'me' }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (old) => {
        if (!old?.pages?.length) return old;
        const pages = old.pages.map((p) => ({
          ...p,
          messages: scope === 'everyone'
            ? p.messages.map((m) => (m.id === id ? { ...m, deleted: true, text: '', file: null } : m))
            : p.messages.filter((m) => m.id !== id),
        }));
        return { ...old, pages };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

/** Ek message ko cache me tombstone bana do — realtime 'chat:deleted' isi se lagta hai. */
export function markDeletedInCache(qc, conversationId, messageId) {
  qc.setQueryData(msgKey(conversationId), (old) => {
    if (!old?.pages?.length) return old;
    const pages = old.pages.map((p) => ({
      ...p,
      messages: p.messages.map((m) => (m.id === messageId ? { ...m, deleted: true, text: '', file: null } : m)),
    }));
    return { ...old, pages };
  });
}

/** Is chat ki ghanti band / chaalu. */
export function useSetMuted(conversationId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (until) => api.post(`/chat/conversations/${conversationId}/mute`, { until }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      // Khuli chat ka header bhi isi se ghanti ka nishaan badalta hai — sirf list
      // refresh karne se wo purana hi dikhta rehta.
      qc.invalidateQueries({ queryKey: msgKey(conversationId) });
    },
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
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Bubble ke beech ka din ka chip. */
export function dayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}


// ── File / photo / PDF ────────────────────────────────────────────────────────

/** Attachment ka button dikhana bhi hai ya nahi (S3 set hai ya nahi). */
export function useMediaConfig() {
  const { data } = useQuery({
    queryKey: ['chat', 'media-config'],
    queryFn: () => api.get('/chat/media-config'),
    // 2 minute, 30 nahi: owner Settings me file-sharing band kare to doosron ke khule
    // tab me paperclip jaldi gayab ho. Endpoint sasta hai (cached setting, S3 nahi).
    staleTime: 2 * 60_000,
  });
  return data ?? { enabled: false, maxBytes: 0 };
}

/**
 * Kisi file ko kholne ka link.
 *
 * Link sirf 5 minute chalta hai (wo khud ek chaabi hai), isliye ise cache me lamba nahi
 * rakha ja sakta — 4 minute baad taaza maang liya jaata hai.
 */
export function useMediaUrl(messageId, { thumb = false, enabled = true, download = false, fresh = false } = {}) {
  const q = thumb ? '?thumb=1' : download ? '?download=1' : '';
  const { data } = useQuery({
    queryKey: ['chat', 'media', messageId, thumb ? 'thumb' : download ? 'download' : 'full', fresh ? 'fresh' : ''],
    queryFn: () => api.get(`/chat/media/${messageId}${q}`),
    enabled: !!messageId && enabled,
    // `fresh`: viewer ke liye har baar naya link — viewer 5 minute se zyada khula rah
    // sakta hai, aur cache wala link beech me mar jaata.
    staleTime: fresh ? 0 : 4 * 60_000,
    gcTime: fresh ? 0 : 5 * 60_000,
    retry: false,
  });
  return data?.url || '';
}

/**
 * File bhejne ka poora safar: chhota karo → thumbnail banao → parwana lo → S3 par
 * chadhao → message bhejo.
 *
 * Bytes kabhi hamare server se nahi guzarte. Progress isliye dikhta hai ki bina uske ek
 * badi file "atki hui" lagti hai, aur cancel isliye ki bada video bhejte waqt uska na
 * hona sabse zyada chidhata hai.
 */
export function useSendFile(conversationId) {
  const qc = useQueryClient();
  const [progress, setProgress] = React.useState(null); // null | 0..100
  const abortRef = React.useRef(null);

  const send = React.useCallback(
    async (file, { caption = '' } = {}) => {
      setProgress(0);
      try {
        const mime = file.type || 'application/octet-stream';
        let blob = file;
        let width = 0;
        let height = 0;
        let durationSec = 0;
        let thumbBlob = null;

        if (isImage(mime)) {
          const shrunk = await shrinkImage(file);
          blob = shrunk.blob; width = shrunk.width; height = shrunk.height;
          thumbBlob = await makeImageThumb(file);
        } else if (isVideo(mime)) {
          const t = await makeVideoThumb(file);
          thumbBlob = t.blob; width = t.width; height = t.height; durationSec = t.durationSec;
        }

        const signed = await api.post(`/chat/conversations/${conversationId}/uploads`, {
          withThumb: !!thumbBlob,
        });

        const up = uploadToS3(signed.file, blob, { onProgress: setProgress });
        abortRef.current = up.abort;
        await up.promise;

        // Thumbnail ka fail hona poore bhejne ko nahi rokta — jhalak na ho to icon chalega.
        if (thumbBlob && signed.thumb) {
          await uploadToS3(signed.thumb, thumbBlob).promise.catch(() => {});
        }

        await api.post(`/chat/conversations/${conversationId}/messages`, {
          text: caption,
          upload: {
            uploadToken: signed.uploadToken,
            name: file.name,
            mime,
            width,
            height,
            durationSec,
          },
        });

        qc.invalidateQueries({ queryKey: msgKey(conversationId) });
        qc.invalidateQueries({ queryKey: LIST_KEY });
      } finally {
        abortRef.current = null;
        setProgress(null);
      }
    },
    [conversationId, qc],
  );

  return { send, progress, cancel: () => abortRef.current?.() };
}


// ── Sirf CEO & President ──────────────────────────────────────────────────────

/** Ek employee ki saari chats ki list (sirf list — koi message nahi). */
export function useUserChats(userId) {
  return useQuery({
    queryKey: ['chat', 'admin', 'chats', userId],
    queryFn: () => api.get(`/chat/admin/users/${userId}/chats`),
    enabled: !!userId,
    staleTime: 60_000,
  });
}

/**
 * Ek poori chat kholo.
 *
 * `enabled` jaan-bujh kar bahar se aata hai: ye call HAR BAAR Activity log me entry
 * banati hai aur us employee ko notification bhejti hai. Isliye ye tabhi chalni chahiye
 * jab admin ne sach me kholne ka faisla kiya ho — kisi hover ya prefetch par nahi.
 */
export function useUserChatMessages(userId, conversationId, enabled) {
  return useQuery({
    queryKey: ['chat', 'admin', 'messages', userId, conversationId],
    queryFn: () => api.get(`/chat/admin/users/${userId}/chats/${conversationId}`),
    enabled: !!userId && !!conversationId && !!enabled,
    // Har GET server par Activity-log entry + us employee ko notification bhejta hai.
    // Isliye ye query APNE AAP kabhi dobara nahi chalti — na focus par, na reconnect par,
    // na stale hone par. Ek baar khola = ek entry. Warna tab badalne bhar se employee ko
    // "aapki chat dekhi gayi" baar-baar jaata.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: false,
  });
}

/** Apni hi chat me dhoondho. */
export function useChatSearch(q) {
  const needle = String(q || '').trim();
  return useQuery({
    queryKey: ['chat', 'search', needle],
    queryFn: () => api.get(`/chat/search?q=${encodeURIComponent(needle)}`),
    enabled: needle.length >= 2,
    staleTime: 30_000,
  });
}
