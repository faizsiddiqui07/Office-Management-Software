'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cake, PartyPopper } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { COMPANY_TZ } from '@/lib/time';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const SEEN_KEY = 'om_birthday_seen'; // stores the YMD we last dismissed on

/** Today's date (YYYY-MM-DD) in company time. */
function companyToday() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TZ }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * On login, if there's a Birthday event on the calendar for today, show a
 * festive popup to EVERYONE. It can't be closed until the acknowledge checkbox is
 * ticked, and once dismissed it won't pop again the same day.
 */
export function BirthdayPopup() {
  const { user } = useAuth();
  const today = companyToday();

  const { data } = useQuery({
    queryKey: ['holidays', 'today', today],
    queryFn: () => api.get(`/holidays?from=${today}&to=${today}`),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const birthdays = React.useMemo(
    () => (data?.holidays ?? []).filter((h) => h.type === 'BIRTHDAY' && h.startYMD <= today && h.endYMD >= today),
    [data, today],
  );

  const [dismissed, setDismissed] = React.useState(true);
  const [checked, setChecked] = React.useState(false);

  React.useEffect(() => {
    let seen = null;
    try {
      seen = localStorage.getItem(SEEN_KEY);
    } catch {
      seen = null;
    }
    setDismissed(seen === today);
    setChecked(false);
  }, [today, birthdays.length]);

  const shouldShow = birthdays.length > 0 && !dismissed;

  const close = () => {
    if (!checked) return; // gate: can't close until acknowledged
    try {
      localStorage.setItem(SEEN_KEY, today);
    } catch {
      /* ignore storage failures */
    }
    setDismissed(true);
  };

  if (!shouldShow) return null;

  const names = birthdays.map((b) => b.title).join(', ');
  const many = birthdays.length > 1;

  return (
    <Dialog open onOpenChange={(o) => (!o ? close() : null)}>
      <DialogContent
        showCloseButton={false}
        className="overflow-hidden border-0 p-0 shadow-glass sm:max-w-md"
      >
        {/* Festive header */}
        <div className="relative bg-gradient-to-br from-fuchsia-500 via-purple-500 to-primary px-6 pb-6 pt-8 text-center text-white">
          <div className="pointer-events-none absolute inset-0 select-none text-lg opacity-70">
            <span className="absolute left-4 top-3">🎈</span>
            <span className="absolute right-5 top-4">🎉</span>
            <span className="absolute left-8 bottom-3">✨</span>
            <span className="absolute right-8 bottom-2">🎊</span>
            <span className="absolute left-1/2 top-2 -translate-x-1/2">🎂</span>
          </div>
          <span className="relative mx-auto flex size-16 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/40 backdrop-blur">
            <Cake className="size-8" />
          </span>
          <DialogTitle className="relative mt-4 text-2xl font-bold tracking-tight text-white">Happy Birthday! 🎉</DialogTitle>
          <p className="relative mt-1 text-sm text-white/90">
            {many ? "Today we celebrate" : "It's a special day"}
          </p>
        </div>

        {/* Names */}
        <div className="px-6 pt-5 text-center">
          <p className="flex items-center justify-center gap-2 text-lg font-semibold">
            <PartyPopper className="size-5 text-fuchsia-500" />
            <span className="break-words">{names}</span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Take a moment to wish {many ? 'them' : 'them'} a wonderful day! 🎂🎈
          </p>
        </div>

        {/* Acknowledge — required before closing */}
        <div className="px-6 pt-5">
          <label
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-xl p-3 ring-1 transition-colors',
              checked ? 'bg-primary/10 ring-primary/30' : 'bg-foreground/[0.04] ring-border/60 hover:bg-foreground/[0.06]',
            )}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="size-4 accent-primary"
            />
            <span className="text-sm font-medium">I&apos;ve wished them a happy birthday! 🎉</span>
          </label>
        </div>

        <DialogFooter className="p-6 pt-4">
          <Button className="w-full" disabled={!checked} onClick={close}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
