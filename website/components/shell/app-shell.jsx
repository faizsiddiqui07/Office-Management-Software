'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { AppSidebar } from './app-sidebar';
import { Topbar } from './topbar';
import { BottomNav } from './bottom-nav';
import { ForcePasswordChange } from '@/components/auth/force-password-change';
import { LoadingState } from '@/components/glass/skeletons';
import { LaunchScreen } from './launch-screen';
import { AnnouncementPopup } from '@/components/announcements/announcement-popup';
import { BirthdayPopup } from '@/components/calendar/birthday-popup';
import { ChatFab } from '@/components/chat/chat-fab';
import { Buddy } from '@/components/buddy/buddy';
import { useVisualViewportFrame } from '@/lib/use-visual-viewport-frame';
import { ProductCredit } from '@/components/shell/brand';
import { ChatRealtimeProvider } from '@/components/chat/chat-realtime';
import { EodDigestPopup } from '@/components/tasks/eod-digest-popup';
import { PwaRegister } from '@/components/pwa/pwa-register';
import { ProfilePhotoPrompt } from '@/components/profile/photo-prompt';
import { WhatsNewDialog } from '@/components/shell/whats-new-dialog';
import { DocumentTitle } from './document-title';
import { UpdatePrompt } from './update-prompt';

/**
 * Auth guard + shell for all /(app) routes. Redirects to /login when
 * unauthenticated, and blocks the app with a forced password change when the
 * account still has mustChangePassword set.
 */
export function AppShell({ children }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Chat phone par page nahi, app jaisi screen hai: topbar ke theek neeche se shuru hoti
  // hai aur asli dikhne wali screen ke neeche par khatam. Shell ka page-padding, mobile ka
  // shortcut bar aur sabse neeche ka product footer — teenon us jagah me se hissa kaat
  // lete the, jiski wajah se page khud scroll karne lagta tha aur composer screen se neeche
  // nikal jaata tha (keyboard khulte hi footer bhi jhaank aata tha). Sirf is ek route par,
  // aur sirf chhoti screen par, wo teenon hat jaate hain. `sm` se upar kuch nahi badalta.
  const appPane = pathname === '/chat';

  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, user, router]);

  // Chat par, phone me: topbar + chat ka poora stack dikhne wale hisse se BANDHA rehta hai,
  // upar aur neeche dono se — iPhone keyboard khulne par page ko pan karta hai aur pehle
  // topbar/header nazar se bahar khisak jaate the. Dekho lib/use-visual-viewport-frame.js.
  // Early return se PEHLE, kyunki hook hain; callback ref dabba aane par khud chalta hai.
  const frameRef = useVisualViewportFrame(appPane);

  // While /bootstrap loads (and while the effect above sends a signed-out visitor to
  // /login): on iOS the twin of the launch image, so the open reads as one continuous
  // screen; everywhere else the plain spinner — Android already had Chrome's own splash.
  // Both are rendered; `data-ios` on <html> (set before first paint) picks one via CSS.
  if (isLoading || !user) {
    return (
      <>
        <LaunchScreen />
        <div className="not-ios flex min-h-dvh items-center justify-center">
          <LoadingState label={isLoading ? 'Loading your workspace…' : 'Redirecting to sign in…'} />
        </div>
      </>
    );
  }

  if (user.mustChangePassword) {
    return <ForcePasswordChange user={user} />;
  }

  return (
    // Chat ka live connection poore shell par — chat band ho tab bhi chalta rehta hai,
    // warna floating button ka unread badge zinda hi na rahe.
    <ChatRealtimeProvider>
    <div className="relative min-h-dvh">
      <DocumentTitle />
      <UpdatePrompt />
      <AppSidebar user={user} />
      {/* Chat + phone: ye dabba fixed hai aur dikhne wale hisse jitna (hook inline style
          deta hai). Andar flex column — topbar apni jagah, `main` baaki saari jagah. */}
      {/* Bottom padding below lg, so the last line of a page is never left sitting under
          the bottom nav bar. Not on the chat pane at phone width: there the bar is hidden
          (chat needs the pixels) and the frame is a measured, fixed-height column, so
          padding would shrink the chat for nothing. From sm up chat is an ordinary
          scrolling page again and does need the room. */}
      {/* A column at least as tall as the screen, with `main` taking whatever is spare —
          so the shortcuts and the credit line sit at the BOTTOM of a short page instead of
          wherever the content happens to stop. Before this they came straight after the
          content: on a page still loading, which is a spinner and nothing else, the two
          coloured buttons landed in the middle of an empty screen (owner's screenshot,
          17 Nov). This matters now because they moved down there; the credit line had the
          same habit before and nobody noticed it on its own.
          NOT on the chat pane at phone width: there the hook gives this box an exact
          height, and `min-h-dvh` would fight it — the box must SHRINK when the keyboard
          opens, which is the whole point of that frame. */}
      <div
        ref={frameRef}
        className={
          appPane
            ? 'lg:pl-64 max-sm:flex max-sm:flex-col sm:flex sm:min-h-dvh sm:flex-col sm:max-lg:pb-[4.75rem]'
            : 'flex min-h-dvh flex-col lg:pl-64 max-lg:pb-[4.75rem]'
        }
      >
        <Topbar user={user} />
        {/* Same width as the topbar above it, which has never been capped. These two used to
            disagree: the bar ran edge to edge while the page under it stopped at 1280px, so on
            anything wider than a laptop the content sat in a narrow column with a bar stretched
            over it. On a 4K screen that was more than a thousand empty pixels down each side. */}
        <main
          className={
            // Phone + chat: `main` frame ki bachi jagah bharta hai, aur `[&>*]` uske SEEDHE
            // bachche ko bhi flex zanjeer me jodta hai. Wo bachcha app/(app)/template.jsx ka
            // fade wala motion.div hai — ek saada block jo apni poori content lambai tak
            // phail jaata tha (composer 1782px par, screen 812 ki). "Reduce motion" par
            // wrapper hota hi nahi, tab ye seedha chat page par lagta hai — dono theek.
            // `flex-1` is what pushes the footer down on a short page — see the comment on
            // the column above. On the chat pane at phone width `max-sm:flex-1` already did
            // this job, for a different reason.
            appPane
              ? 'w-full max-sm:flex max-sm:min-h-0 max-sm:flex-1 max-sm:flex-col max-sm:[&>*]:flex max-sm:[&>*]:min-h-0 max-sm:[&>*]:flex-1 max-sm:[&>*]:flex-col sm:flex-1 sm:px-6 sm:pb-6 sm:pt-4 lg:px-8'
              : 'w-full flex-1 px-4 pb-6 pt-4 sm:px-6 lg:px-8'
          }
        >
          {children}
        </main>
        {/* The "My tasks / Assigned tasks" bar stood here until 17 Nov 2026. It existed to
            reach the To-Do page from anywhere on a phone — and the bottom bar now has
            To-Do as a tab, so it was a second door to the same room, sitting on every
            single page. Owner called it: "ab unki zaroorat to hai nahi."
            What it did beyond a plain /todo link was land on a chosen TAB (?tab=assigned).
            That costs one extra tap now — the page's own tabs are right there — and the
            query parameters still work, because notification links use them too. */}
        {/* Har page ke neeche product ka naam — hardcode, Settings se nahi (owner ka niyam).

            PHONE PAR NEECHE SIRF `pb-2` (owner, 21 Nov 2026 — "ye space bahot jyada hai").
            Wajah: is footer ke neeche shell ka apna `max-lg:pb-[4.75rem]` pehle se 76px
            de raha hai (bottom bar ke liye). Uske OOPAR 32px aur dene se naam aur bar ke
            beech 55px ki khaali patti ban jaati thi.
            SHELL WALI 76px KO MAT CHHEDNA — wo naap kar rakhi gayi hai (dekho BottomNav);
            ghatane par content bar ke peeche chhup jaata hai. `sm` se upar footer apni
            poori `pb-8` rakhta hai, kyunki wahan bottom bar hai hi nahi. */}
        <footer
          className={`w-full px-4 pb-2 pt-2 text-center text-[11px] text-muted-foreground sm:px-6 sm:pb-8 lg:px-8 ${
            appPane ? 'hidden sm:block' : ''
          }`}
        >
          <ProductCredit />
        </footer>
      </div>
      {/* Phone aur tablet ki navigation — neeche, jahan angootha pehle se hai.
          `lg` se upar ye khud chhup jaati hai, wahan asli sidebar aa jaata hai. */}
      <BottomNav />
      {/* Chat ka floating button — shell me, kisi page ke andar NAHI: page template ka
          framer-motion wrapper `position: fixed` ko todta hai (dekho chat-fab.jsx). */}
      <ChatFab />
      {/* AI Buddy — chat ke button se thoda upar. Ye bhi shell me hi hai, usi wajah se
          jo ChatFab par likhi hai (page template ka framer-motion `fixed` ko todta hai). */}
      <Buddy />
      <BirthdayPopup />
      {/* Owners only, after the office cut-off, once a day — see the component. */}
      <EodDigestPopup />
      <AnnouncementPopup />
      {/* Sabse aakhir me, taaki baaki popups ke UPAR aaye: jiski photo nahi, use pehle
          yahi dikhe — naya employee password badalte hi isi par utarta hai. */}
      <ProfilePhotoPrompt />
      {/* SABSE AAKHIR me, yaani sab popups ke UPAR: koi bada update live hone ke baad app
          khulte hi pehle yahi dikhna chahiye (owner, 19 Nov 2026). Naye bande ko purani
          updates dikhti hi nahi, to pehle din wala photo-prompt isse nahi dabta. */}
      <WhatsNewDialog />
      <PwaRegister />
    </div>
    </ChatRealtimeProvider>
  );
}
