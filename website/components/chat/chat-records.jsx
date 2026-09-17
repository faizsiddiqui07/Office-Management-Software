'use client';

import * as React from 'react';
import { ShieldCheck, Search, AlertTriangle, ArrowLeft, Paperclip, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { GlassCard } from '@/components/glass/glass-card';
import { EmptyState } from '@/components/glass/empty-state';
import { useContacts, useUserChats, useUserChatMessages, chatInitials, chatTime, dayLabel } from '@/lib/chat';
import { prettyBytes } from '@/lib/chat-media';

/**
 * CEO & President ke liye — kisi employee ki chat nikalna.
 *
 * Ye screen jaan-bujh kar "bhaari" mehsoos hoti hai. Chat kholna ek faisla hai, ek click
 * nahi: har baar Activity log me entry banti hai AUR us employee ko notification jaata
 * hai. Isliye kholne se PEHLE ek saaf chetavni dikhti hai — taaki koi galti se, ya bina
 * soche, kisi ki nijee baat na khol de.
 *
 * Isi wajah se message tab tak maange hi nahi jaate jab tak "Kholein" na dabaya jaye —
 * warna sirf naam par click karne se hi notification chala jaata.
 */
function ConfirmOpen({ personName, withName, onCancel, onConfirm }) {
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full bg-warning/15">
        <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400" />
      </div>
      <h3 className="text-base font-semibold">Open this chat?</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        You are about to open the conversation between <b>{personName}</b> and <b>{withName}</b>.
      </p>
      <div className="mx-auto mt-4 max-w-sm rounded-lg bg-foreground/[0.05] px-4 py-3 text-left text-xs leading-relaxed text-muted-foreground">
        Two things happen automatically the moment you open it:
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li>An entry is written to the Activity log — when, and under your name.</li>
          <li><b>{personName}</b> is notified that their chat was viewed.</li>
        </ul>
      </div>
      <div className="mt-5 flex justify-center gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={onConfirm}>Yes, open it</Button>
      </div>
    </div>
  );
}

function AdminMessage({ m, personId }) {
  const fromTarget = String(m.senderId) === String(personId);
  return (
    <div className={cn('flex w-full', fromTarget ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3 py-2 text-sm',
          fromTarget ? 'rounded-br-sm bg-primary/15' : 'rounded-bl-sm bg-foreground/[0.06]',
        )}
      >
        <p className="mb-0.5 text-[11px] font-semibold text-muted-foreground">{m.senderName}</p>
        {m.file ? (
          <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Paperclip className="size-3.5 shrink-0" />
            <span className="truncate">{m.file.name}</span>
            <span className="shrink-0">· {prettyBytes(m.file.size)}</span>
          </p>
        ) : null}
        {m.text ? <p className="whitespace-pre-wrap break-words">{m.text}</p> : null}
        <p className="mt-0.5 text-right text-[10px] text-muted-foreground">
          {new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}
          {m.deletedForCount ? ' · deleted by a participant (for themselves)' : ''}
        </p>
      </div>
    </div>
  );
}

export function ChatRecords() {
  const [q, setQ] = React.useState('');
  const [person, setPerson] = React.useState(null);
  const [chat, setChat] = React.useState(null);
  const [confirmed, setConfirmed] = React.useState(false);

  const { data: people } = useContacts();
  const { data: chats, isLoading: loadingChats } = useUserChats(person?.id);
  const { data: opened, isLoading: loadingMsgs, error } = useUserChatMessages(person?.id, chat?.id, confirmed);

  const needle = q.trim().toLowerCase();
  const list = (people ?? []).filter((u) => !needle || u.name.toLowerCase().includes(needle));

  // Banda ya chat badle to confirmation dobara maango — ek baar "haan" kehna aage ke
  // liye khula parwana nahi ban sakta.
  const pickPerson = (u) => { setPerson(u); setChat(null); setConfirmed(false); };
  const pickChat = (c) => { setChat(c); setConfirmed(false); };

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* Kiski chat */}
      <GlassCard className="flex h-[calc(100dvh-20rem)] min-h-[340px] flex-col overflow-hidden p-0 lg:h-[calc(100dvh-16rem)]">
        <div className="shrink-0 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="records-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Whose chat?"
              className="bg-background/50 pl-9"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {list.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => pickPerson(u)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-foreground/5',
                person?.id === u.id && 'bg-primary/10 hover:bg-primary/10',
              )}
            >
              <Avatar className="size-8 shrink-0">
                {u.avatarUrl ? <AvatarImage src={u.avatarUrl} alt={u.name} /> : null}
                <AvatarFallback className="text-[10px]">{chatInitials(u.name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{u.name}</span>
                {u.designation ? (
                  <span className="block truncate text-xs text-muted-foreground">{u.designation}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </GlassCard>

      {/* Uski chats, aur khuli hui chat */}
      <GlassCard className="flex h-[calc(100dvh-20rem)] min-h-[340px] flex-col overflow-hidden p-0 lg:h-[calc(100dvh-16rem)]">
        {!person ? (
          <div className="grid h-full place-items-center p-6">
            <EmptyState
              icon={ShieldCheck}
              title="Select a person"
              description="Pick someone on the left to see their list of chats."
            />
          </div>
        ) : !chat ? (
          <>
            <div className="shrink-0 border-b border-border/60 px-4 py-3">
              <p className="text-sm font-semibold">{person.name}&apos;s chats</p>
              <p className="text-xs text-muted-foreground">Opening one is logged, and they are notified.</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loadingChats ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
              ) : null}
              {!loadingChats && !chats?.chats?.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">This person has no chats.</p>
              ) : null}
              {(chats?.chats ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pickChat(c)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-foreground/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.with?.name ?? '—'}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.messageCount} {c.messageCount === 1 ? 'message' : 'messages'} · last {chatTime(c.lastMessageAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : !confirmed ? (
          <ConfirmOpen
            personName={person.name}
            withName={chat.with?.name ?? '—'}
            onCancel={() => setChat(null)}
            onConfirm={() => setConfirmed(true)}
          />
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2.5">
              <button
                type="button"
                onClick={() => { setChat(null); setConfirmed(false); }}
                className="rounded-full p-1.5 hover:bg-foreground/10"
                aria-label="Back"
              >
                <ArrowLeft className="size-4" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {person.name} ↔ {chat.with?.name ?? '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {opened?.conversation?.messageCount ?? chat.messageCount} messages
                  {opened?.truncated ? ' · showing the beginning only' : ''}
                </p>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-3">
              {loadingMsgs ? (
                <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Opening…
                </p>
              ) : null}
              {error ? (
                <p className="py-8 text-center text-sm text-destructive">This chat could not be opened.</p>
              ) : null}
              {(opened?.messages ?? []).map((m, i, arr) => {
                const prev = arr[i - 1];
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
                    <AdminMessage m={m} personId={person.id} />
                  </React.Fragment>
                );
              })}
            </div>
          </>
        )}
      </GlassCard>
    </div>
  );
}
