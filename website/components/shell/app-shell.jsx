'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { AppSidebar } from './app-sidebar';
import { Topbar } from './topbar';
import { ForcePasswordChange } from '@/components/auth/force-password-change';
import { LoadingState } from '@/components/glass/skeletons';
import { AnnouncementPopup } from '@/components/announcements/announcement-popup';
import { BirthdayPopup } from '@/components/calendar/birthday-popup';
import { PwaRegister } from '@/components/pwa/pwa-register';
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
    <div className="relative min-h-dvh">
      <DocumentTitle />
      <UpdatePrompt />
      <AppSidebar user={user} />
      <div className="lg:pl-64">
        <Topbar user={user} />
        <main className="mx-auto w-full max-w-7xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
      <BirthdayPopup />
      <AnnouncementPopup />
      <PwaRegister />
    </div>
  );
}
