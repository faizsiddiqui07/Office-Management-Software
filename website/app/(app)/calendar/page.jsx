import { CalendarRange } from 'lucide-react';
import { PageHeader } from '@/components/glass/page-header';
import { HolidayCalendar } from '@/components/calendar/holiday-calendar';
import { UpcomingHolidays } from '@/components/calendar/upcoming-holidays';

export default function CalendarPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Calendar"
        title="Holidays & calendar"
        icon={CalendarRange}
        description="Company holidays and events — shared with everyone. Admins can add and edit."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <HolidayCalendar />
        <UpcomingHolidays />
      </div>
    </div>
  );
}
