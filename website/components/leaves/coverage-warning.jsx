'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { requestTypeLabel, formatRange } from '@/lib/leave';

/**
 * Shown to an approver reviewing a request: who ELSE is already approved off (leave or
 * WFH) on overlapping dates, so a whole team isn't accidentally signed off the same days.
 * WFH people are listed separately and NOT counted as "off" — they're still working, just
 * from home. Purely a heads-up; it never blocks the approve/reject buttons.
 */
export function CoverageWarning({ leave }) {
  const from = leave?.startYMD;
  const to = leave?.endYMD;
  const exclude = leave?.user?.id ?? leave?.user?._id ?? '';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['leaves', 'coverage', from, to, exclude],
    queryFn: () => api.get(`/leaves/coverage?from=${from}&to=${to}&exclude=${exclude}`),
    enabled: !!from && !!to,
    staleTime: 30 * 1000,
  });

  if (!from || !to) return null;
  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Checking who else is off these dates…</p>;
  }
  if (isError) return null; // a heads-up that can't load must never get in the way of a decision

  const people = data?.people ?? [];
  const off = people.filter((p) => !p.isWFH);
  const wfh = people.filter((p) => p.isWFH);

  if (!off.length && !wfh.length) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs text-success ring-1 ring-success/20">
        <Check className="size-3.5 shrink-0" /> No one else is approved off during these dates.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg bg-warning/10 px-3 py-2.5 text-xs ring-1 ring-warning/25">
      {off.length ? (
        <div className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-amber-700 dark:text-amber-300">
              {off.length} already off during these dates
            </p>
            <ul className="space-y-0.5 text-muted-foreground">
              {off.map((p) => (
                <li key={p.id} className="break-words">
                  <span className="font-medium text-foreground">{p.name}</span> · {requestTypeLabel(p.type)} · {formatRange(p.startYMD, p.endYMD)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {wfh.length ? (
        <p className="break-words text-muted-foreground">
          <span className="font-medium text-foreground">{wfh.length} working from home:</span>{' '}
          {wfh.map((p) => p.name).join(', ')}
        </p>
      ) : null}
    </div>
  );
}
