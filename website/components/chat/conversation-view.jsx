'use client';

import * as React from 'react';
import { ArrowLeft, Bell, BellOff, Check, CheckCheck, Clock, CornerUpLeft, Paperclip, Send, Trash2, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  useMessages, useSendMessage, useMarkRead, useDeleteMessage, chatInitials, dayLabel,
} from '@/lib/chat';
import { useChatRealtime } from './chat-realtime';
import { useMediaConfig, useSendFile, useSetMuted } from '@/lib/chat';
import { FileBubble, ImageViewer } from './file-bubble';
import { prettyBytes } from '@/lib/chat-media';

/** Sent / delivered / read — sirf apne bheje hue message par. */
function Ticks({ msg, peerDelivered, peerRead }) {
  if (!msg.mine) return null;
  if (msg.pending) return <Clock className="size-3.5 shrink-0 opacity-60" />;
  if (msg.seq <= peerRead) return <CheckCheck className="size-3.5 shrink-0 text-sky-400" />;
  if (msg.seq <= peerDelivered) return <CheckCheck className="size-3.5 shrink-0 opacity-60" />;
  return <Check className="size-3.5 shrink-0 opacity-60" />;
}

const clock = (iso) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

function Bubble({ msg, peerDelivered, peerRead, onReply, onDelete, onOpenImage }) {
  return (
    <div className={cn('group flex w-full gap-1.5', msg.mine ? 'justify-end' : 'justify-start')}>
      {/* Actions — hover par, bubble ke bahar, taaki text kabhi na dhanke */}
      <div
        className={cn(
          'flex items-center gap-0.5 self-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100',
          msg.mine ? 'order-first' : 'order-last',
        )}
      >
        <button
          type="button"
          onClick={() => onReply(msg)}
          title="Jawab dein"
          className="rounded-full p-1.5 text-muted-foreground hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <CornerUpLeft className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(msg)}
          title="Mere liye hata dein"
          className="rounded-full p-1.5 text-muted-foreground hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div
        className={cn(
          'max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm',
          msg.file && 'px-1.5 pt-1.5',
          msg.mine
            ? 'rounded-br-sm bg-primary text-primary-foreground'
            : 'rounded-bl-sm bg-foreground/[0.06] text-foreground',
          msg.pending && 'opacity-70',
        )}
      >
        {msg.replyTo ? (
          <div
            className={cn(
              'mb-1.5 border-l-2 pl-2 text-xs',
              msg.mine ? 'border-primary-foreground/50 text-primary-foreground/80' : 'border-primary/60 text-muted-foreground',
            )}
          >
            <p className="line-clamp-2">{msg.replyTo.text}</p>
          </div>
        ) : null}

        {msg.file ? (
          <div className={cn(msg.text && 'mb-1.5')}>
            <FileBubble
              messageId={msg.id}
              file={msg.file}
              mine={msg.mine}
              onOpenImage={() => onOpenImage(msg)}
            />
          </div>
        ) : null}

        {msg.text ? <p className="whitespace-pre-wrap break-words">{msg.text}</p> : null}

        <span
          className={cn(
            'mt-0.5 flex items-center justify-end gap-1 text-[10px]',
            msg.mine ? 'text-primary-foreground/70' : 'text-muted-foreground',
          )}
        >
          {clock(msg.createdAt)}
          <Ticks msg={msg} peerDelivered={peerDelivered} peerRead={peerRead} />
        </span>
      </div>
    </div>
  );
}

export function ConversationView({ conversationId, peer, onBack, showBack = false }) {
  const { messages, conversation, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useMessages(conversationId);
  const send = useSendMessage(conversationId);
  const markRead = useMarkRead();
  const del = useDeleteMessage(conversationId);
  const { setActive } = useChatRealtime();

  // Server ko batao ki ye chat is waqt saamne khuli hai — tabhi wo iska push bhejna
  // chhod deta hai. Band karte waqt saaf karna zaroori hai, warna chat band hone ke baad
  // bhi notification rukte rahenge.
  React.useEffect(() => {
    setActive(conversationId || null);
    return () => setActive(null);
  }, [conversationId, setActive]);

  const media = useMediaConfig();
  const upload = useSendFile(conversationId);
  const setMuted = useSetMuted(conversationId);
  const [text, setText] = React.useState('');
  const [replyTo, setReplyTo] = React.useState(null);
  const [atBottom, setAtBottom] = React.useState(true);
  const [viewing, setViewing] = React.useState(null); // poori screen wali photo
  const [fileError, setFileError] = React.useState('');
  const fileRef = React.useRef(null);

  const scrollRef = React.useRef(null);
  const bottomRef = React.useRef(null);
  const topRef = React.useRef(null);
  const inputRef = React.useRef(null);

  const who = conversation?.peer ?? peer;
  const peerDelivered = conversation?.peerDeliveredUpToSeq ?? 0;
  const peerRead = conversation?.peerReadUpToSeq ?? 0;
  const lastSeq = messages.length ? messages[messages.length - 1].seq : 0;

  // Neeche hone par hi apne aap scroll karo — warna koi purana message padh raha ho aur
  // naya aa jaye to screen uske neeche khisak jaayegi.
  React.useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, atBottom]);

  // Chat khuli hai aur neeche tak dikh rahi hai → padha hua maano.
  React.useEffect(() => {
    if (!conversationId || !lastSeq || !atBottom) return;
    if (!conversation?.myUnread) return;
    markRead.mutate({ conversationId, upToSeq: lastSeq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, lastSeq, atBottom, conversation?.myUnread]);

  // Upar pahunchte hi purana page — scroll ki jagah wahin rakhte hue.
  React.useEffect(() => {
    const node = topRef.current;
    const box = scrollRef.current;
    if (!node || !box || !hasNextPage) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || isFetchingNextPage) return;
        const before = box.scrollHeight;
        fetchNextPage().then(() => {
          requestAnimationFrame(() => {
            box.scrollTop += box.scrollHeight - before;
          });
        });
      },
      { root: box, rootMargin: '80px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const onScroll = (e) => {
    const el = e.currentTarget;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const submit = (e) => {
    e?.preventDefault();
    const clean = text.trim();
    if (!clean || send.isPending) return;
    send.mutate({ text: clean, replyToSeq: replyTo?.seq, replyPreview: replyTo?.text });
    setText('');
    setReplyTo(null);
    setAtBottom(true);
    inputRef.current?.focus();
  };

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // wahi file dobara chunne par bhi onChange chale
    if (!file) return;
    setFileError('');
    if (media.maxBytes && file.size > media.maxBytes) {
      setFileError(`File bahut badi hai — ${prettyBytes(media.maxBytes)} tak hi bhej sakte hain`);
      return;
    }
    setAtBottom(true);
    try {
      await upload.send(file, { caption: text.trim() });
      setText('');
    } catch (err) {
      if (!err?.cancelled) setFileError(err?.message || 'File nahi bheji ja saki');
    }
  };

  return (
    // `relative`: scroll-to-bottom button isi ke against baithta hai, warna wo poore
    // page ke kisi upar wale positioned parent par chala jaata hai.
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-3 py-2.5">
        {showBack ? (
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 rounded-full p-1.5 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label="Wapas"
          >
            <ArrowLeft className="size-4" />
          </button>
        ) : null}
        <Avatar className="size-9">
          {who?.avatarUrl ? <AvatarImage src={who.avatarUrl} alt={who.name} /> : null}
          <AvatarFallback className="text-xs">{chatInitials(who?.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{who?.name ?? '…'}</p>
          {who?.designation ? (
            <p className="truncate text-xs text-muted-foreground">{who.designation}</p>
          ) : null}
        </div>

        {/* Ghanti band/chaalu — sirf IS chat ke liye, aur sirf MERE liye. Saamne wale ko
            kuch pata nahi chalta (WhatsApp me bhi aisa hi hai). */}
        <button
          type="button"
          onClick={() =>
            setMuted.mutate(
              conversation?.muted ? null : new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
            )}
          className="shrink-0 rounded-full p-2 text-muted-foreground hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label={conversation?.muted ? 'Notification chaalu karein' : 'Is chat ki notification band karein'}
          title={conversation?.muted ? 'Notification band hai — chaalu karein' : 'Notification band karein'}
        >
          {conversation?.muted ? <BellOff className="size-4" /> : <Bell className="size-4" />}
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div ref={topRef} />
        {isFetchingNextPage ? (
          <p className="py-2 text-center text-xs text-muted-foreground">Purane message aa rahe hain…</p>
        ) : null}

        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Khul raha hai…</p>
        ) : null}

        {!isLoading && !messages.length ? (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">Abhi koi message nahi.</p>
            <p className="mt-1 text-xs text-muted-foreground">Neeche likh kar shuruaat karein.</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            return (
              <React.Fragment key={m.id}>
                {newDay ? (
                  <div className="my-2 flex justify-center">
                    <span className="rounded-full bg-foreground/[0.07] px-3 py-1 text-[11px] text-muted-foreground">
                      {dayLabel(m.createdAt)}
                    </span>
                  </div>
                ) : null}
                <Bubble
                  msg={m}
                  peerDelivered={peerDelivered}
                  peerRead={peerRead}
                  onReply={setReplyTo}
                  onDelete={(x) => !x.pending && del.mutate(x.id)}
                  onOpenImage={setViewing}
                />
              </React.Fragment>
            );
          })}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom */}
      {!atBottom ? (
        <button
          type="button"
          onClick={() => {
            setAtBottom(true);
            bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }}
          className="absolute bottom-20 right-4 grid size-9 place-items-center rounded-full border border-border/60 bg-background/90 shadow-md backdrop-blur hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label="Neeche jayein"
        >
          <ChevronDown className="size-4" />
        </button>
      ) : null}

      {/* Composer */}
      <form onSubmit={submit} className="shrink-0 border-t border-border/60 p-2.5">
        {replyTo ? (
          <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-primary bg-foreground/[0.05] px-2.5 py-1.5">
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{replyTo.text}</p>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="rounded-full p-0.5 hover:bg-foreground/10"
              aria-label="Jawab hataayein"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}

        {upload.progress !== null ? (
          <div className="mb-2 flex items-center gap-3 rounded-lg bg-foreground/[0.05] px-3 py-2">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${upload.progress}%` }}
              />
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{upload.progress}%</span>
            <button
              type="button"
              onClick={upload.cancel}
              className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-foreground/10"
              aria-label="Upload rok dein"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}

        {fileError ? (
          <p className="mb-2 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{fileError}</p>
        ) : null}

        <div className="flex items-end gap-2">
          {media.enabled ? (
            <>
              <input
                id="chat-file"
                ref={fileRef}
                type="file"
                className="sr-only"
                onChange={pickFile}
                accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={upload.progress !== null}
                className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                aria-label="File bhejein"
                title="Photo, video, PDF ya document bhejein"
              >
                <Paperclip className="size-4" />
              </button>
            </>
          ) : null}
          <textarea
            id="chat-composer"
            ref={inputRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter bhejta hai, Shift+Enter nayi line — WhatsApp desktop jaisa.
              if (e.key === 'Enter' && !e.shiftKey) submit(e);
            }}
            placeholder="Message likhein…"
            className="max-h-32 min-h-9 flex-1 resize-none rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          />
          <Button type="submit" size="icon" disabled={!text.trim() || send.isPending} className="size-9 shrink-0 rounded-full">
            <Send className="size-4" />
          </Button>
        </div>
      </form>

      {viewing ? (
        <ImageViewer
          messageId={viewing.id}
          name={viewing.file?.name || 'Photo'}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}
