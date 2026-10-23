'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Send, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { BuddyBlob } from './buddy-blob';

/**
 * Buddy se baat karne ka hissa — SIRF baatcheet, koi panel/sheet nahi.
 *
 * Jaan-bujh kar alag rakha hai. Panel wala raasta asli Android par pehle ek baar toot
 * chuka hai (dekho chat-fab.jsx ka comment: page ke glass cards slide-over ke upar paint
 * ho rahe the). Agar buddy ke saath bhi wahi hua, to is component ko ek poore `/buddy`
 * page me rakh dena das line ka kaam hai — baatcheet dobara nahi likhni padegi.
 */

const CHIPS = [
  'Mera overtime kitna hua?',
  'Kitne leave bache hain?',
  'Meri pending tasks',
  'Agli chhutti kab hai?',
];

function Bubble({ role, text }) {
  const mine = role === 'user';
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
          mine
            ? 'rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md bg-muted text-foreground',
        )}
      >
        {text}
      </div>
    </div>
  );
}

export function BuddyChat({ userName }) {
  const [turns, setTurns] = React.useState([]);
  const [draft, setDraft] = React.useState('');
  const endRef = React.useRef(null);
  const inputRef = React.useRef(null);

  const askIt = useMutation({
    mutationFn: (question) => api.post('/assistant/ask', { question }),
    onSuccess: (res) => setTurns((t) => [...t, { role: 'buddy', text: res.answer }]),
    onError: (e) =>
      setTurns((t) => [
        ...t,
        // Rate limit ka message backend se aata hai aur saaf hota hai ("is ghante ke
        // sawaal poore ho gaye") — use chhupa kar "kuch galat ho gaya" likhna bekaar hai.
        { role: 'buddy', text: e?.message || 'Abhi jawab nahi de paya. Thodi der baad poochhiye.', failed: true },
      ]),
  });

  const send = (q) => {
    const text = String(q ?? draft).trim();
    if (!text || askIt.isPending) return;
    setTurns((t) => [...t, { role: 'user', text }]);
    setDraft('');
    askIt.mutate(text);
  };

  // Naya jawab aate hi neeche — warna lamba jawab aadha kat kar dikhta hai.
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns.length, askIt.isPending]);

  const first = turns.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
        {first ? (
          <div className="flex flex-col items-center px-2 py-6 text-center">
            <BuddyBlob size={72} eager />
            <p className="mt-3 text-sm font-medium">
              {userName ? `Namaste ${userName.split(' ')[0]}!` : 'Namaste!'}
            </p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
              Apni attendance, chhutti, points, tasks ya office ke niyam — kuch bhi poochhiye.
              Jis bhasha me poochhenge, usi me jawab milega.
            </p>
            <div className="mt-5 flex w-full flex-wrap justify-center gap-2">
              {CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => send(c)}
                  className="rounded-full bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-border transition-colors hover:text-foreground"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((t, i) => (
          <Bubble key={i} role={t.role} text={t.text} />
        ))}

        {askIt.isPending ? (
          <div className="flex items-center gap-2 px-1">
            {/* Jawab me 2–4 second lagte hain, isliye kuch na kuch hilta rehna chahiye —
                warna lagta hai app atak gayi. */}
            <BuddyBlob size={26} eager />
            <span className="text-xs text-muted-foreground">soch raha hoon…</span>
          </div>
        ) : null}

        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-border/60 px-3 py-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter bhejta hai, Shift+Enter nayi line — chat ka aam niyam.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Kuch poochhiye…"
          maxLength={500}
          className="max-h-28 min-h-10 flex-1 resize-none rounded-xl bg-muted/50 px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-2 focus:ring-primary/40"
        />
        {turns.length ? (
          <Button type="button" variant="ghost" size="icon" title="Nayi baat shuru karein" onClick={() => setTurns([])}>
            <RotateCcw className="size-4" />
          </Button>
        ) : null}
        <Button type="submit" size="icon" disabled={!draft.trim() || askIt.isPending} aria-label="Bhejein">
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
