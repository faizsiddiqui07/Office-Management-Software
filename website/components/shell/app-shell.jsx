'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { AppSidebar } from './app-sidebar';
import { Topbar } from './topbar';
import { QuickTaskActions } from './quick-task-actions';
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
      <div ref={frameRef} className={appPane ? 'lg:pl-64 max-sm:flex max-sm:flex-col' : 'lg:pl-64'}>
        <Topbar user={user} />
        {/* My tasks / Assigned tasks shortcuts, on every page — see the component.
            Chat par ye SIRF phone par chhupta hai: wahi ek jagah hai jahan chat ko har
            pixel chahiye. `sm:contents` se wrapper usse badi screen par layout me se gayab
            ho jaata hai, isliye bar ki apni sticky position bilkul waisi hi rehti hai
            jaisi baaki pages par — tablet par kuch nahi badalta. */}
        {appPane ? (
          <div className="hidden sm:contents">
            <QuickTaskActions />
          </div>
        ) : (
          <QuickTaskActions />
        )}
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
            appPane
              ? 'w-full max-sm:flex max-sm:min-h-0 max-sm:flex-1 max-sm:flex-col max-sm:[&>*]:flex max-sm:[&>*]:min-h-0 max-sm:[&>*]:flex-1 max-sm:[&>*]:flex-col sm:px-6 sm:pb-6 sm:pt-4 lg:px-8'
              : 'w-full px-4 pb-6 pt-4 sm:px-6 lg:px-8'
          }
        >
          {children}
        </main>
        {/* Har page ke neeche product ka naam — hardcode, Settings se nahi (owner ka niyam). */}
        <footer
          className={`w-full px-4 pb-8 pt-2 text-center text-[11px] text-muted-foreground sm:px-6 lg:px-8 ${
            appPane ? 'hidden sm:block' : ''
          }`}
        >
          <ProductCredit />
        </footer>
      </div>
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
      <PwaRegister />
    </div>
    </ChatRealtimeProvider>
  );
}
