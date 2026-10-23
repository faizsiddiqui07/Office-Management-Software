'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { BuddyBlob } from './buddy-blob';
import { BuddyChat } from './buddy-chat';

/**
 * Buddy ka floating button + uska panel.
 *
 * `AppShell` me render hota hai, kisi page ke andar NAHI — wahi wajah jo chat-fab.jsx me
 * likhi hai: har `/(app)` page framer-motion ke wrapper me hai, aur animate hote waqt
 * uska `will-change` containing block ban jaata hai, jisse andar ka `position: fixed`
 * har navigation par khisak jaata hai.
 *
 * Panel ke liye app ka apna `Sheet` use kiya hai, naya kuch nahi banaya — usme Android
 * wala compositing bug pehle se handle hai (overlay par phone par blur nahi lagta, aur
 * popup ka background opaque hai). Yahi wo bug tha jisne chat ka slide-over toda tha.
 *
 * Key na lagi ho to `/assistant/status` `enabled:false` bhejta hai aur buddy dikhta hi
 * nahi — aadha-adhoora button dikha kar "kaam nahi kar raha" sunne se behtar hai.
 */
export function Buddy() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  const { data } = useQuery({
    queryKey: ['assistant', 'status'],
    queryFn: () => api.get('/assistant/status'),
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  if (!user || !data?.enabled) return null;

  // Chat page par chat ka button chhup jaata hai (dekho chat-fab.jsx), to buddy akela
  // upar tairta rehta — neeche aa jaata hai taaki wahan bhi theek baithe.
  const onChatPage = pathname === '/chat' || pathname?.startsWith('/chat/');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Buddy se poochhein"
        className={cn(
          'fixed right-7 z-50 grid size-12 place-items-center rounded-full',
          onChatPage ? 'bottom-7' : 'bottom-24',
          'bg-background/80 shadow-lg shadow-black/15 ring-1 ring-border',
          'supports-backdrop-filter:backdrop-blur-sm',
          'transition-transform hover:scale-105 active:scale-95',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          'motion-reduce:transition-none motion-reduce:hover:scale-100',
        )}
      >
        <BuddyBlob size={34} playing={!open} />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          // SheetContent khud scroll karta hai; yahan andar ki baatcheet apna scroll
          // sambhalti hai, isliye bahar wala band.
          // `data-[side=right]:` ke saath likhna zaroori hai: Sheet ki apni
          // `data-[side=right]:w-3/4` saadi `w-full` se jeet jaati hai, aur phone par
          // panel 281px ka reh jaata tha — baayein 94px ki bekaar patti ke saath.
          className="gap-0 overflow-hidden p-0 data-[side=right]:w-full sm:data-[side=right]:w-3/4 sm:max-w-md"
        >
          <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3">
            <BuddyBlob size={30} playing={open} eager />
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-sm">Buddy</SheetTitle>
              <SheetDescription className="text-xs">Office ke sawaalon ka jawab</SheetDescription>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Band karein
            </button>
          </div>
          <BuddyChat userName={user.name} />
        </SheetContent>
      </Sheet>
    </>
  );
}
