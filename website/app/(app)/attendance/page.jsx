'use client';

import * as React from 'react';
import { CalendarClock } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { useBadges, useSeen, CORRECTIONS_KEY } from '@/lib/badges';
import { PageHeader } from '@/components/glass/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckInCard } from '@/components/attendance/check-in-card';
import { AttendanceHistory } from '@/components/attendance/attendance-history';
import { EveryoneTab } from '@/components/attendance/everyone-tab';
import { MyRegularizations } from '@/components/attendance/my-regularizations';
import { RegularizationQueue } from '@/components/attendance/regularization-queue';

function MeView() {
  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <CheckInCard />
        <AttendanceHistory />
      </div>
      <MyRegularizations />
    </div>
  );
}

export default function AttendancePage() {
  const { user } = useAuth();
  const params = useSearchParams();
  const canMark = !!user && can(user, 'markAttendance');
  const canSeeEveryone = !!user && can(user, 'viewEveryone');
  const isApprover = !!user && can(user, 'approveRegularization');

  const tabs = [
    canMark && { value: 'me', label: 'My attendance' },
    canSeeEveryone && { value: 'everyone', label: 'Everyone' },
    isApprover && { value: 'corrections', label: 'Corrections' },
  ].filter(Boolean);

  const requested = params.get('tab');
  const initialTab = tabs.some((t) => t.value === requested) ? requested : tabs[0]?.value;

  // The Corrections tab keeps its own dot: opening Attendance clears the sidebar
  // one, but the tab stays marked until it's actually opened.
  const badges = useBadges();
  const { isNew, markSeen } = useSeen();
  const correctionsNew = isApprover && isNew(CORRECTIONS_KEY, badges.attendance);

  React.useEffect(() => {
    if (initialTab === 'corrections') markSeen(CORRECTIONS_KEY);
  }, [initialTab, markSeen]);

  const description = canMark
    ? 'Mark your attendance — check-in and check-out times are captured automatically.'
    : "Track your team's attendance and approve correction requests.";

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Attendance" title="Attendance" icon={CalendarClock} description={description} />

      {tabs.length > 1 ? (
        <Tabs
          key={initialTab}
          defaultValue={initialTab}
          onValueChange={(v) => {
            if (v === 'corrections') markSeen(CORRECTIONS_KEY);
          }}
        >
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                {t.value === 'corrections' && correctionsNew ? (
                  <span className="ml-1.5 size-2 rounded-full bg-destructive" aria-label="New" />
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
          {canMark ? (
            <TabsContent value="me" className="pt-6">
              <MeView />
            </TabsContent>
          ) : null}
          {canSeeEveryone ? (
            <TabsContent value="everyone" className="pt-6">
              <EveryoneTab />
            </TabsContent>
          ) : null}
          {isApprover ? (
            <TabsContent value="corrections" className="pt-6">
              <RegularizationQueue />
            </TabsContent>
          ) : null}
        </Tabs>
      ) : canMark ? (
        <MeView />
      ) : canSeeEveryone ? (
        <EveryoneTab />
      ) : (
        <RegularizationQueue />
      )}
    </div>
  );
}
