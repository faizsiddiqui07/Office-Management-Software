import { CalendarRange } from 'lucide-react';
import { PageHeader } from '@/components/glass/page-header';
import { HolidayCalendar } from '@/components/calendar/holiday-calendar';
import { UpcomingHolidays } from '@/components/calendar/upcoming-holidays';
import { HolidayListDownload } from '@/components/calendar/holiday-list-download';

export default function CalendarPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Holidays & calendar"
        icon={CalendarRange}
        description="Company holidays and events — shared with everyone. Admins can add and edit."
        actions={<HolidayListDownload />}
      />
      {/* `minmax(0,1fr)`, kora `1fr` nahi: `1fr` ka chhupa hua minimum uske ANDAR ke
          content se aata hai, to calendar grid khud ko sikod nahi pata aur 300px wala
          saathi dab jaata hai (Attendance page par yahi galti naapi gayi thi — wahan
          card 360px ki jagah 269px ka reh gaya tha). */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <HolidayCalendar />
        <UpcomingHolidays />
      </div>
    </div>
  );
}
