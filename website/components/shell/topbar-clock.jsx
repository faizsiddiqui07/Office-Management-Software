'use client';

import * as React from 'react';
import { Clock } from 'lucide-react';
import { useSettings } from '@/lib/settings';
import { safeTimeZone } from '@/lib/time';

/** Live company-time clock for the (otherwise empty) left of the topbar. */
export function TopbarClock() {
  const { data: settings } = useSettings();
  const tz = safeTimeZone(settings?.timezone); // never crash on a bad/free-text zone
  const [now, setNow] = React.useState(null);

  React.useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Until mounted, mirror the row's shape to avoid a hydration mismatch + layout shift.
  if (!now) {
    return (
      <div className="flex items-center gap-3" aria-hidden>
        <span className="size-9 rounded-xl bg-primary/10" />
        <div className="space-y-1.5">
          <div className="h-3.5 w-16 rounded bg-muted/50" />
          <div className="h-3 w-28 rounded bg-muted/40" />
        </div>
      </div>
    );
  }

  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: tz,
  }).format(now);
  const date = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: tz,
  }).format(now);
  const tzShort = tz.split('/').pop().replace(/_/g, ' ');

  return (
    <div className="flex items-center gap-3" aria-label={`Company time ${time}, ${date}, ${tzShort}`}>
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
        <Clock className="size-[18px]" />
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold tabular-nums tracking-tight">{time}</p>
        <p className="text-xs text-muted-foreground">
          {date} · {tzShort}
        </p>
      </div>
    </div>
  );
}
