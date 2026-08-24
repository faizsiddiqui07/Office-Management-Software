'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import { expandEventDates } from '@/lib/calendar';
import { companyTodayYMD } from '@/lib/expense';
import { APP_LIVE_YMD } from '@/lib/app-live';

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_WEEKEND = [0]; // Sunday only — module-level so the fallback keeps a stable identity

/**
 * A guard for TASK due-date pickers: which days may NOT be a deadline, and why.
 *
 * A task's overdue penalty is never charged on a non-working day (the bonus service's
 * per-day drip skips the owner's weekly off-days and company holidays), so a deadline that
 * lands on a Sunday or a holiday makes no sense. The picker blocks those days and, when one
 * is tapped, names the reason ("Sunday (weekly off)", "Holiday — Eid").
 *
 * Reads the same two sources the leave dialog uses: mandatory holidays from GET /holidays
 * (server-expanded, honouring countsForWorkingDays) and the company weekly-off from the
 * settings singleton. Returns a `dayBlock(ymd)` predicate for <DatePicker dayBlock=…>:
 * a reason string when the day is blocked, otherwise null.
 */
export function useDueDateBlocker() {
  const { data: settings } = useSettings();
  const weekendDays = settings?.weekendDays ?? DEFAULT_WEEKEND; // 0 = Sunday … 6 = Saturday

  const today = companyTodayYMD();
  // Cover every pickable day: from go-live (edit mode can reach back to it) to ~2 years out.
  const from = APP_LIVE_YMD < today ? APP_LIVE_YMD : today;
  const to = `${Number(today.slice(0, 4)) + 2}${today.slice(4)}`;
  const { data: holData } = useQuery({
    queryKey: ['holidays', 'range', from, to],
    queryFn: () => api.get(`/holidays?from=${from}&to=${to}`),
    staleTime: 5 * 60 * 1000,
  });

  // ymd -> holiday name; mandatory HOLIDAY only (exactly the set the penalty-skip uses).
  const holidayByDay = useMemo(() => {
    const m = new Map();
    for (const h of holData?.holidays ?? []) {
      if (h.type !== 'HOLIDAY' || h.countsForWorkingDays === false) continue;
      for (const d of expandEventDates(h)) if (!m.has(d)) m.set(d, h.title);
    }
    return m;
  }, [holData]);

  return useMemo(
    () => (ymd) => {
      if (!ymd) return null;
      // UTC-pinned, like every other date read in the app, so no device timezone shifts it.
      const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
      if (weekendDays.includes(dow)) return `${DOW_NAMES[dow]} (weekly off)`;
      const name = holidayByDay.get(ymd);
      if (name) return `Holiday — ${name}`;
      return null;
    },
    [weekendDays, holidayByDay],
  );
}
