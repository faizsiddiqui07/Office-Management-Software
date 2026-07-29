'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Moon } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { COMPANY_TZ } from '@/lib/time';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const SEEN_KEY = 'om_eod_seen'; // the YMD this device last closed the round-up on

/** Today's date (YYYY-MM-DD) in company time. */
function companyToday() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TZ }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * The evening round-up, for CEO & President only.
 *
 * After the office's cut-off time, the first time they open the app that day they see
 * what everyone finished — person by person, numbered. Close it and it's done: nothing
 * is stored anywhere, and it won't come back until tomorrow's list exists.
 *
 * The whole thing is read live off the tasks each time it's asked for; the only trace
 * kept anywhere is a date in this browser saying "today's has been seen".
 */
export function EodDigestPopup() {
  const { user } = useAuth();
  const today = companyToday();
  const isOwner = !!user?.isOwner;

  // Already closed today? Then never ask the server at all.
  const [dismissed, setDismissed] = React.useState(true);
  React.useEffect(() => {
    let seen = null;
    try { seen = localStorage.getItem(SEEN_KEY); } catch { seen = null; }
    setDismissed(seen === today);
  }, [today]);

  const { data } = useQuery({
    queryKey: ['tasks', 'eod-digest', today],
    queryFn: () => api.get('/tasks/eod-digest'),
    enabled: isOwner && !dismissed,
    // It only turns "ready" once, at the cut-off — a slow poll picks that up for
    // somebody who left the app open through the evening, without being chatty.
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    staleTime: 60 * 1000,
  });

  const close = () => {
    try { localStorage.setItem(SEEN_KEY, today); } catch { /* ignore storage failures */ }
    setDismissed(true);
  };

  // Nothing to celebrate = nothing to interrupt anyone with.
  if (!isOwner || dismissed || !data?.ready || !data.people?.length) return null;

  const { people, total } = data;

  return (
    <Dialog open onOpenChange={(o) => (!o ? close() : null)}>
      <DialogContent className="overflow-hidden border-0 p-0 shadow-glass sm:max-w-lg">
        <div className="bg-gradient-to-br from-indigo-500 via-primary to-sky-500 px-6 pb-6 pt-8 text-center text-white">
          <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/40 backdrop-blur">
            <Moon className="size-8" />
          </span>
          <DialogTitle className="mt-4 text-2xl font-bold tracking-tight text-white">Today&apos;s work</DialogTitle>
          <p className="mt-1 text-sm text-white/90">
            {total} {total === 1 ? 'task' : 'tasks'} finished by {people.length} {people.length === 1 ? 'person' : 'people'}
          </p>
        </div>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto px-6 py-5">
          {people.map((p) => (
            <div key={`${p.name}-${p.employeeId}`}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold tracking-tight">{p.name}</p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.tasks.length} {p.tasks.length === 1 ? 'task' : 'tasks'}
                </span>
              </div>
              <ol className="mt-1 space-y-1">
                {p.tasks.map((t, i) => (
                  <li key={`${p.employeeId}-${i}`} className="flex gap-2 text-sm text-muted-foreground">
                    <span className="shrink-0 tabular-nums text-foreground/60">{i + 1}.</span>
                    <span className="min-w-0 break-words">{t}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>

        <DialogFooter className="border-t border-border/50 p-6 pt-4">
          <Button className="w-full" onClick={close}>
            <ClipboardCheck className="size-4" /> Done for the day
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
