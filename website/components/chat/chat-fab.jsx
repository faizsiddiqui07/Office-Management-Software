'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatUnread } from '@/lib/chat';

/**
 * Har page par bottom-right ka chat button — tap karte hi /chat page khulta hai.
 *
 * Pehle ye ek slide-over panel kholta tha (neeche se upar aata hua). Wo hata diya, do
 * wajah se: (1) owner ne kaha ki button seedha chat page par le jaye, mobile aur desktop
 * dono par; (2) asli Android phone par wo panel "fat" jaata tha — page ke glass cards
 * (backdrop-filter) panel ke background ke UPAR aur uske text ke NEECHE paint hote the.
 * Ye Chrome Android ka compositing bug hai jo emulator me nahi dikhta. Ek poora page
 * hone se ye class ka bug yahan aa hi nahi sakta.
 *
 * Ye `AppShell` me render hota hai, kisi page ke andar NAHI — har `/(app)` page
 * `app/(app)/template.jsx` ke framer-motion wrapper me hai, aur animate hote waqt uska
 * `will-change` containing block ban jaata hai, jo andar ke `position: fixed` bachche ko
 * har navigation par khiskaa deta hai. Shell template ke bahar hai, isliye yahan `fixed`
 * sach me screen se chipka rehta hai.
 *
 * `Link` isliye, button + router.push nahi: Link /chat ko pehle se prefetch kar leta hai,
 * to tap par page turant aata hai — "smoothly" ka yahi matlab hai.
 *
 * /chat par button chhupa dete hain — jo cheez saamne khuli hai uska shortcut dikhana
 * sirf jagah kharab karta hai.
 */
export function ChatFab() {
  const pathname = usePathname();
  const unread = useChatUnread();

  // Theek `/chat` aur uske andar ke raaste — `/chat-records` (owner ki alag screen)
  // par button dikhna chahiye, wo chat karne ki jagah nahi hai.
  const onChatPage = pathname === '/chat' || pathname?.startsWith('/chat/');
  if (onChatPage) return null;

  return (
    <Link
      href="/chat"
      aria-label={`Open chat${unread ? ` — ${unread} unread` : ''}`}
      className={cn(
        // Back on every screen size (owner, 17 Nov 2026). It spent a few hours hidden on
        // phones while Chat had a slot in the bottom bar; the owner wanted the button
        // instead, so Chat gave its slot back to the work shortcuts.
        //
        // SMALLER on phone and tablet than it used to be — the owner asked for that in the
        // same breath, and it now shares the bottom-right corner with a nav bar underneath
        // and the Buddy button above, where a 56px circle was simply too much. 48px is
        // still past the 44px a thumb needs. Laptop has the room, so there it is unchanged.
        'fixed bottom-[5.5rem] right-6 z-50 grid size-12 place-items-center rounded-full lg:bottom-6 lg:size-14',
        'bg-primary text-primary-foreground shadow-lg shadow-primary/25',
        'transition-transform hover:scale-105 active:scale-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2',
        'motion-reduce:transition-none motion-reduce:hover:scale-100',
      )}
    >
      <MessageCircle className="size-5 lg:size-6" />
      {unread ? (
        <span className="absolute -right-0.5 -top-0.5 grid min-w-6 place-items-center rounded-full bg-destructive px-1.5 py-0.5 text-[11px] font-bold leading-none text-white ring-2 ring-background">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
