'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { MessageCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatUnread } from '@/lib/chat';
import { ChatWindow } from './chat-window';

/**
 * Har page par bottom-right ka chat button, aur uska slide-over panel.
 *
 * Ye `AppShell` me render hota hai, kisi page ke andar NAHI — aur ye majboori hai, shauq
 * nahi: har `/(app)` page `app/(app)/template.jsx` ke framer-motion wrapper me hai, aur
 * animate hote waqt uska `will-change` containing block ban jaata hai, jo andar ke kisi
 * bhi `position: fixed` bachche ko har navigation par khiskaa deta hai. Shell template ke
 * bahar hai, isliye yahan `fixed` sach me screen se chipka rehta hai.
 * (Yahi baat components/shell/quick-task-actions.jsx ke comment me bhi likhi hai.)
 *
 * /chat par button chhupa dete hain — jo cheez saamne khuli hai uska shortcut dikhana
 * sirf jagah kharab karta hai.
 */
export function ChatFab() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const unread = useChatUnread();

  // Theek `/chat` aur uske andar ke raaste — `/chat-records` (owner ki alag screen)
  // par button dikhna chahiye, wo chat karne ki jagah nahi hai.
  const onChatPage = pathname === '/chat' || pathname?.startsWith('/chat/');

  // Escape se band, aur khula ho to background scroll na ho (phone par panel ke peeche
  // page khiskta rehna sabse zyada khalta hai).
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (onChatPage) return null;

  return (
    <>
      {/* Backdrop */}
      {open ? (
        <button
          type="button"
          aria-label="Chat band karein"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px] animate-in fade-in"
        />
      ) : null}

      {/* Panel */}
      <div
        className={cn(
          'fixed z-50 flex flex-col overflow-hidden border-border/60 bg-background shadow-2xl transition-transform duration-200 ease-out',
          // Phone: neeche se poori chaudai. Desktop: daayin taraf ek lamba panel.
          'inset-x-0 bottom-0 h-[82dvh] rounded-t-2xl border-t',
          'sm:inset-x-auto sm:bottom-24 sm:right-6 sm:h-[min(620px,calc(100dvh-10rem))] sm:w-[392px] sm:rounded-2xl sm:border',
          // `invisible` band haalat me zaroori hai: sirf khiska dene se panel screen se
          // bahar to chala jaata hai par uske button Tab se abhi bhi pakde jaate hain —
          // keyboard wala banda ek aisi cheez par pahunch jaata jo dikh hi nahi rahi.
          open ? 'visible translate-y-0' : 'invisible pointer-events-none translate-y-[110%] sm:translate-y-4 sm:opacity-0',
        )}
        aria-hidden={!open}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold">Chat</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label="Band karein"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {/* Band hone par mount hi na ho — warna har page par chat ki queries chalti
              rahengi aur mobile data + database dono bewajah kharch honge. */}
          {open ? <ChatWindow mode="panel" /> : null}
        </div>
      </div>

      {/* Button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Chat band karein' : `Chat kholein${unread ? ` — ${unread} naye message` : ''}`}
        className={cn(
          'fixed bottom-6 right-6 z-50 grid size-14 place-items-center rounded-full',
          'bg-primary text-primary-foreground shadow-lg shadow-primary/25',
          'transition-transform hover:scale-105 active:scale-95',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2',
          'motion-reduce:transition-none motion-reduce:hover:scale-100',
        )}
      >
        {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
        {!open && unread ? (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-6 place-items-center rounded-full bg-destructive px-1.5 py-0.5 text-[11px] font-bold leading-none text-white ring-2 ring-background">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
    </>
  );
}
