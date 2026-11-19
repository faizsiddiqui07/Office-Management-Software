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
      {/*
        DO COLUMN, PAR TABHI JAB SACH ME JAGAH HO.
        Pehle yahan `lg:grid-cols-[minmax(0,360px)_1fr]` tha, aur wo do tarah se galat tha:

        1. `1fr` ka apna chhupa hua minimum uske ANDAR ke content se aata hai, aur andar
           history table hai jiske har cell par `whitespace-nowrap` hai (ui/table.jsx) —
           yaani wo ~667px se neeche ja hi nahi sakti. Doosri taraf `minmax(0,360px)` ka
           minimum poora 0 hai. Nateeja: table pehle apne 667px le leti thi aur check-in
           card ko jo bachta wo milta tha. Naapa gaya: 1280px par card 269px ka, aur
           1024px par sirf 13px ka — poora content bahar nikla hua.
           Ilaaj: table wale track ko `minmax(0,1fr)` karo (ab uska minimum sach me 0 hai,
           aur zaroorat padne par wo apne `overflow-x-auto` me khisak jaati hai), aur card
           wale track ko ek ASLI minimum do.

        2. Breakpoint bhi galat tha. 1024px par sidebar BHI khulta hai (256px le jaata hai)
           aur do-column BHI shuru ho jaata tha — dono ek saath, jabki bachi hui chaudai
           me do haath aate hi nahi.

           Hadd `2xl` (1536px) hai, aur ye naap kar chuni gayi hai: table ko 667px
           chahiye, card ko 360px, beech me 24px — yaani 1051px ki grid. Shell sidebar
           (256px) aur page padding milakar ~330px khaa jaate hain, to window ~1381px se
           kam par do-column me table ko sideways scroll karna padta hai. Tailwind ki
           agli hadd 2xl hai, aur wahan grid ~1206px ki hoti hai — dono aaram se aate
           hain. Usse neeche ek-ke-neeche-ek BEHTAR hai, bura nahi: card ab apni chaudai
           dekh kar khud chhota ho jaata hai (check-in-card ka @container), aur table ko
           poori chaudai mil jaati hai — koi scroll nahi.
      */}
      <div className="grid gap-6 2xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)]">
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
    if (initialTab === 'corrections' && correctionsNew) markSeen(CORRECTIONS_KEY);
  }, [initialTab, correctionsNew, markSeen]);

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
