'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { AppSidebar } from './app-sidebar';
import { Topbar } from './topbar';
import { QuickTaskActions } from './quick-task-actions';
import { ForcePasswordChange } from '@/components/auth/force-password-change';
import { LoadingState } from '@/components/glass/skeletons';
import { AnnouncementPopup } from '@/components/announcements/announcement-popup';
import { BirthdayPopup } from '@/components/calendar/birthday-popup';
import { ChatFab } from '@/components/chat/chat-fab';
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

  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingState label="Loading your workspace…" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingState label="Redirecting to sign in…" />
      </div>
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
      <div className="lg:pl-64">
        <Topbar user={user} />
        {/* My tasks / Assigned tasks shortcuts, on every page — see the component. */}
        <QuickTaskActions />
        <main className="mx-auto w-full max-w-7xl px-4 pb-6 pt-4 sm:px-6 lg:px-8">
          {children}
        </main>
        {/* Har page ke neeche product ka naam — hardcode, Settings se nahi (owner ka niyam). */}
        <footer className="mx-auto w-full max-w-7xl px-4 pb-8 pt-2 text-center text-[11px] text-muted-foreground sm:px-6 lg:px-8">
          <ProductCredit />
        </footer>
      </div>
      {/* Chat ka floating button — shell me, kisi page ke andar NAHI: page template ka
          framer-motion wrapper `position: fixed` ko todta hai (dekho chat-fab.jsx). */}
      <ChatFab />
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
