'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Send, Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { firstName } from '@/lib/name';
import { BuddyBlob } from './buddy-blob';

/**
 * Buddy se baat karne ka hissa — SIRF baatcheet, koi panel/sheet nahi.
 *
 * Jaan-bujh kar alag rakha hai. Panel wala raasta asli Android par pehle ek baar toot
 * chuka hai (dekho chat-fab.jsx ka comment: page ke glass cards slide-over ke upar paint
 * ho rahe the). Agar buddy ke saath bhi wahi hua, to is component ko ek poore `/buddy`
 * page me rakh dena das line ka kaam hai — baatcheet dobara nahi likhni padegi.
 */

// English me — app ka baaki UI bhi English me hai (owner, 24 Oct). Jawab ki bhasha
// alag baat hai: wo sawaal ki bhasha se tay hoti hai, chip ki bhasha se nahi.
const CHIPS = [
  'My overtime this month',
  'How much leave is left?',
  'My pending tasks',
  'When is the next holiday?',
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
  // Ek waqt me ek hi tajweez. Yahan sirf `id` aur dikhane wali line rehti hai — kya
  // hoga wo server ke paas likha hai, client ke paas kabhi nahi aata.
  const [pending, setPending] = React.useState(null);
  const endRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const listRef = React.useRef(null);
  // Purani baatein ek saath nahi aatin — upar scroll karne par page-dar-page.
  const [older, setOlder] = React.useState({ hasMore: false, oldest: null, loading: false });
  const [booted, setBooted] = React.useState(false);
  // Neeche chipke raho ya nahi. Naya jawab aaye to haan; purani baatein upar judein
  // to NAHI — warna padhte-padhte screen neeche kood jaati hai.
  const stick = React.useRef(true);
  // Pichhli scroll position. Purani baatein SIRF tab aati hain jab user KHUD upar ki
  // taraf scroll kare. Bina iske panel khulte hi sab aa jaata tha: khulne par jo
  // auto-scroll neeche jaata hai wo bhi scroll event chalata hai, aur us waqt scrollTop
  // 0 ke paas hota hai — handler ko lagta hai user upar pahunch gaya.
  const lastTop = React.useRef(0);

  // Panel khulte hi aakhri kuch baatein. 90 din ki poori history kabhi nahi.
  React.useEffect(() => {
    let dead = false;
    api.get('/assistant/history')
      .then((r) => {
        if (dead) return;
        setTurns((r.turns || []).map((t) => ({ role: t.role, text: t.text })));
        setOlder({ hasMore: !!r.hasMore, oldest: r.oldest, loading: false });
      })
      .catch(() => {})
      .finally(() => { if (!dead) setBooted(true); });
    return () => { dead = true; };
  }, []);

  const loadOlder = React.useCallback(async () => {
    const box = listRef.current;
    if (!box || older.loading || !older.hasMore || !older.oldest) return;
    setOlder((o) => ({ ...o, loading: true }));
    try {
      const r = await api.get(`/assistant/history?before=${encodeURIComponent(older.oldest)}`);
      const before = box.scrollHeight;
      stick.current = false;
      setTurns((t) => [...(r.turns || []).map((x) => ({ role: x.role, text: x.text })), ...t]);
      setOlder({ hasMore: !!r.hasMore, oldest: r.oldest, loading: false });
      // Jahan padh rahe the wahin raho: upar jitna juda, utna neeche khisak jao.
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop += listRef.current.scrollHeight - before;
      });
    } catch {
      setOlder((o) => ({ ...o, loading: false }));
    }
  }, [older]);

  const askIt = useMutation({
    mutationFn: (question) => api.post('/assistant/ask', { question }),
    onSuccess: (res) => {
      stick.current = true;
      setTurns((t) => [...t, { role: 'buddy', text: res.answer }]);
      setPending(res.pending || null);
    },
    onError: (e) => {
      stick.current = true;
      setTurns((t) => [
        ...t,
        // Rate limit ka message backend se aata hai aur saaf hota hai ("is ghante ke
        // sawaal poore ho gaye") — use chhupa kar "kuch galat ho gaya" likhna bekaar hai.
        { role: 'buddy', text: e?.message || 'Could not answer just now. Please try again in a moment.', failed: true },
      ]);
    },
  });

  // Confirm — server ko sirf `id` jaata hai.
  const doIt = useMutation({
    mutationFn: (id) => api.post('/assistant/confirm', { id }),
    onSuccess: (res) => {
      setPending(null);
      setTurns((t) => [...t, { role: 'buddy', text: `Done — ${res.summary}` }]);
    },
    onError: (e) => {
      setPending(null);
      setTurns((t) => [...t, { role: 'buddy', text: e?.message || 'That could not be done.' }]);
    },
  });

  const send = (q) => {
    const text = String(q ?? draft).trim();
    if (!text || askIt.isPending) return;
    // Naya sawaal poochha, matlab purani tajweez chhodi — wo server par apne aap
    // 15 minute me mit jaati hai, par button turant hat jaana chahiye.
    setPending(null);
    stick.current = true;
    setTurns((t) => [...t, { role: 'user', text }]);
    setDraft('');
    askIt.mutate(text);
  };

  // Naya jawab aate hi neeche — warna lamba jawab aadha kat kar dikhta hai.
  React.useEffect(() => {
    if (!stick.current) return;
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns.length, askIt.isPending, pending]);

  // Khaali screen sirf tab jab history aa chuki ho aur sach me kuch na ho — warna
  // purani baatein aane se theek pehle "Hi!" jhalak jaata hai.
  const first = booted && turns.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={(e) => {
          const top = e.currentTarget.scrollTop;
          const goingUp = top < lastTop.current;
          lastTop.current = top;
          if (goingUp && top < 60) loadOlder();
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3"
      >
        {older.loading ? (
          <p className="py-2 text-center text-xs text-muted-foreground">loading older…</p>
        ) : null}
        {first ? (
          <div className="flex flex-col items-center px-2 py-6 text-center">
            <BuddyBlob size={72} eager />
            <p className="mt-3 text-sm font-medium">
              {firstName(userName) ? `Hi ${firstName(userName)}!` : 'Hi there!'}
            </p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
              Ask about your attendance, leave, points, tasks or the office rules.
              Ask in any language — the answer comes back in the same one.
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

        {/* Tajweez — jab tak Confirm na ho, kuch hua nahi hai. Isliye yahan wahi line
            dikhti hai jo server ne banayi, aur wahi line Activity log me bhi jaati hai. */}
        {pending && !askIt.isPending ? (
          <div className="rounded-2xl bg-muted/60 p-3 ring-1 ring-border">
            <p className="text-sm leading-relaxed">{pending.summary}</p>
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" onClick={() => doIt.mutate(pending.id)} disabled={doIt.isPending} className="gap-1.5">
                <Check className="size-3.5" /> {doIt.isPending ? 'Doing…' : 'Confirm'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPending(null)} disabled={doIt.isPending} className="gap-1.5">
                <X className="size-3.5" /> Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {askIt.isPending ? (
          <div className="flex items-center gap-2 px-1">
            {/* Jawab me 2–4 second lagte hain, isliye kuch na kuch hilta rehna chahiye —
                warna lagta hai app atak gayi. */}
            <BuddyBlob size={26} eager />
            <span className="text-xs text-muted-foreground">thinking…</span>
          </div>
        ) : null}

        <div ref={endRef} />
      </div>

      {/* Logon ko pata hona chahiye ki baat kahan ja rahi hai aur kab tak rahegi. */}
      <p className="px-4 pb-1 text-center text-[11px] leading-tight text-muted-foreground">
        Chats are saved securely and removed after 90 days.
      </p>

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
          placeholder="Ask something…"
          maxLength={500}
          className="max-h-28 min-h-10 flex-1 resize-none rounded-xl bg-muted/50 px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-2 focus:ring-primary/40"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!draft.trim() || askIt.isPending}
          aria-label="Send"
          /* Wahi ek-tap wali wajah jo chat ke composer par likhi hai
             (components/chat/conversation-view.jsx) — yahan bhi keyboard khula hota hai
             aur panel ki height visualViewport se bandhi hai, to bina iske pehla tap
             sirf keyboard band karta. */
          onMouseDown={(e) => e.preventDefault()}
        >
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
