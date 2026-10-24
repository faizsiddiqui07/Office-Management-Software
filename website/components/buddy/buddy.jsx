'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useVisualViewportFrame } from '@/lib/use-visual-viewport-frame';
import { BuddyBlob } from './buddy-blob';
import { BuddyChat } from './buddy-chat';

/**
 * Panel ke andar ka hissa — header aur baatcheet, keyboard ke hisaab se naapa hua.
 *
 * Ye ALAG component isliye hai, Buddy ke andar inline nahi: `useViewportFill` ka effect
 * apne component ke MOUNT par chalta hai, aur Buddy to hamesha mounted rehta hai. Panel
 * band hone par element hota hi nahi, to hook pehli baar null dekh kar chup baith jaata
 * tha aur dobara chalta hi nahi — height kabhi lagti hi nahi thi. Yahan component panel
 * ke saath hi janamta hai, to naap sahi waqt par hoti hai.
 *
 * Hook PANEL par nahi, uske ANDAR wale column par hai: `SheetContent` `forwardRef` nahi
 * hai (React 18 me `ref` props me jaata hi nahi, wo chupchaap gir jaata hai), aur panel
 * ko poora rehne dena behtar bhi hai — uska opaque background keyboard ke peechhe bhi
 * faila rehta hai, to wahan safed kuch jhalak hi nahi sakta.
 */
function PanelBody({ user, onClose }) {
  // Column dikhne wale hisse jitna (`vv.height`) aur utna hi neeche khiska jitna iOS ne
  // keyboard ke liye pan kiya (`vv.offsetTop`). Pehle yahan useViewportFill tha: wo sirf
  // NEECHE ka hissa pakadta — composer keyboard ke upar rehta, par pan ke saath header
  // ("ManagiBot AI" + Close) nazar se upar nikal jaata. Chat page wali hi dikkat aur wahi
  // ilaaj (lib/use-visual-viewport-frame.js); Sheet pehle se `fixed inset-y-0` hai, isliye
  // yahan `relative` mode — column bas usi ke andar khiskta hai. Har screen par chalta hai:
  // desktop par pan hota hi nahi, to wahan ye bas poori height hai.
  const colRef = useVisualViewportFrame(true, { position: 'relative', media: null, lockClass: null });

  return (
    <div ref={colRef} className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3">
        <BuddyBlob size={30} playing eager />
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-sm">ManagiBot AI</SheetTitle>
          <SheetDescription className="text-xs">Answers about your office</SheetDescription>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Close
        </button>
      </div>
      <BuddyChat userName={user.name} />
    </div>
  );
}

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

  /**
   * Phone ka Back button pehle PANEL band kare, app nahi.
   *
   * Panel khulte hi history me ek khaali entry daal dete hain. Back dabane par wahi
   * entry hatti hai — page wahin ka wahin rehta hai, bas panel band ho jaata hai. Isi
   * wajah se "dashboard se khola to dashboard par, kisi aur page se khola to usi page
   * par" apne aap sahi rehta hai: hum kabhi kahin gaye hi nahi.
   */
  React.useEffect(() => {
    if (!open) return undefined;
    window.history.pushState({ buddy: true }, '');
    const onPop = () => setOpen(false);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Panel kisi aur tarah se band hua (Close, Escape, bahar tap) — to hamari daali
      // hui entry abhi bhi history me hai. Use hata do, warna agli baar Back dabane
      // par kuch nahi hoga aur user ko lagega button kharab hai.
      if (window.history.state?.buddy) window.history.back();
    };
  }, [open]);

  const { data } = useQuery({
    queryKey: ['assistant', 'status'],
    queryFn: () => api.get('/assistant/status'),
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  if (!user || !data?.enabled) return null;

  // CHAT PAGE PAR BUDDY BILKUL NAHI.
  //
  // Pehle yahan buddy ko sirf neeche khiska diya tha (chat ka apna button wahan chhup
  // jaata hai, dekho chat-fab.jsx). Wo galat tha: chat page ka apna composer aur send
  // button theek wahin hote hain, to blob unke UPAR baith gaya — iPhone par wo send
  // button dhak raha tha, aur uska backdrop-blur composer ke glass ke saath milkar
  // text ko dhundhla kar raha tha.
  //
  // Chat ek poori screen hai jiska apna neecha pehle se bhara hua hai. Wahan koi bhi
  // tairta button takrayega hi, isliye chat ke button ki tarah buddy bhi chhup jaata
  // hai — ek tap me wapas aa kar poochha ja sakta hai.
  if (pathname === '/chat' || pathname?.startsWith('/chat/')) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask ManagiBot AI"
        className={cn(
          'fixed bottom-24 right-7 z-50 grid size-12 place-items-center rounded-full',
          // Ghera patla rakha hai: blob 44px aur button 48px, yaani har taraf sirf 2px.
          // Pehle blob 34px ka tha aur 7px ka gehra ghera use dabaa deta tha — icon
          // chhota lagta tha aur button ek kaala gola.
          // Koi backdrop-blur NAHI. 48px ke button par wo dikhta kuch nahi, aur iOS par
          // page ke glass cards ke saath milkar wahi compositing gadbad karta hai jo
          // chat ke slide-over ko tod chuki hai (dekho chat-fab.jsx). Opaque hi theek.
          'bg-background shadow-lg shadow-black/15 ring-1 ring-border/70',
          'transition-transform hover:scale-105 active:scale-95',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          'motion-reduce:transition-none motion-reduce:hover:scale-100',
        )}
      >
        <BuddyBlob size={44} playing={!open} />
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
          <PanelBody user={user} onClose={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
