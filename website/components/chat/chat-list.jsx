'use client';

import * as React from 'react';
import { Search, MessageSquarePlus, BellOff, Check, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useConversations, useContacts, chatInitials, chatTime } from '@/lib/chat';

/**
 * Chat list par apne aakhri message ka tick — wahi teen haalat jo bubble par hoti hain.
 * Hamesha double-tick dikhana aasan tha par jhooth hota: saamne wale ne kholi bhi na ho
 * to bhi "padh liya" jaisa lagta.
 */
function ListTick({ c }) {
  if (c.lastMessageSeq <= (c.peerReadUpToSeq ?? 0)) {
    return <CheckCheck className="size-3.5 shrink-0 text-sky-400" />;
  }
  if (c.lastMessageSeq <= (c.peerDeliveredUpToSeq ?? 0)) {
    return <CheckCheck className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return <Check className="size-3.5 shrink-0 text-muted-foreground" />;
}

function Row({ avatarUrl, name, sub, time, unread, muted, active, tick, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        'hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        active && 'bg-primary/10 hover:bg-primary/10',
      )}
    >
      <Avatar className="size-10 shrink-0">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
        <AvatarFallback className="text-xs">{chatInitials(name)}</AvatarFallback>
      </Avatar>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
          {time ? <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{time}</span> : null}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {tick}
          <span className={cn('truncate text-xs', unread ? 'text-foreground/80' : 'text-muted-foreground')}>
            {sub || ' '}
          </span>
          {muted ? <BellOff className="ml-auto size-3 shrink-0 text-muted-foreground" /> : null}
          {unread ? (
            <span className="ml-auto grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

/**
 * Baayin taraf ki list: pehle chal rahi chats, phir "Sab log".
 *
 * Office app me contact list banane ki zaroorat hi nahi — har active colleague pehle se
 * contact hai. Isliye "naya chat" ka koi alag flow nahi: jis se abhi tak baat nahi hui
 * wo neeche "Sab log" me mil jaata hai, aur usi ek search box se dono chhante jaate hain.
 */
export function ChatList({ activeId, onOpenConversation, onOpenPeer }) {
  const [q, setQ] = React.useState('');
  const { data: conversations, isLoading } = useConversations();
  const { data: contacts } = useContacts();

  const needle = q.trim().toLowerCase();
  const convs = (conversations ?? []).filter((c) => !needle || c.peer?.name?.toLowerCase().includes(needle));

  // "Sab log" me wahi log jinke saath koi chat abhi chal nahi rahi — warna har naam do
  // baar dikhega (ek chat me, ek yahan).
  const talkingTo = new Set((conversations ?? []).map((c) => c.peer?.id));
  const others = (contacts ?? []).filter(
    (u) => !talkingTo.has(u.id) && (!needle || u.name.toLowerCase().includes(needle) || u.designation?.toLowerCase().includes(needle)),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pb-2 pt-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="chat-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Naam se dhoondhein…"
            className="bg-background/50 pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isLoading ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Khul rahi hai…</p>
        ) : null}

        {convs.map((c) => (
          <Row
            key={c.id}
            avatarUrl={c.peer?.avatarUrl}
            name={c.peer?.name ?? 'Unknown'}
            sub={c.lastMessageKind === 'FILE' ? 'Ek file' : c.lastMessage}
            time={chatTime(c.lastMessageAt)}
            unread={c.unread}
            muted={c.muted}
            active={c.id === activeId}
            tick={c.lastMessageMine ? <ListTick c={c} /> : null}
            onClick={() => onOpenConversation(c)}
          />
        ))}

        {others.length ? (
          <>
            <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Sab log
            </p>
            {others.map((u) => (
              <Row
                key={u.id}
                avatarUrl={u.avatarUrl}
                name={u.name}
                sub={u.designation}
                onClick={() => onOpenPeer(u)}
              />
            ))}
          </>
        ) : null}

        {!isLoading && !convs.length && !others.length ? (
          <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
            <MessageSquarePlus className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {needle ? 'Is naam ka koi nahi mila' : 'Abhi koi chat nahi'}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
