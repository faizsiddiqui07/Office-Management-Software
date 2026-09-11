import { cn } from '@/lib/utils';
import { GlassCard } from '@/components/glass/glass-card';
import { StatusBadge } from '@/components/glass/status-badge';
import { Repeat, CalendarClock } from 'lucide-react';
import { PRIORITY, formatDateTime, describeRecurrence } from '@/lib/announcement';

export function AnnouncementCard({ announcement, actions, receipts }) {
  const a = announcement;
  const p = PRIORITY[a.priority] ?? PRIORITY.NORMAL;
  const repeats = describeRecurrence(a.recurrence);

  return (
    <GlassCard className={cn('p-5', a.priority === 'URGENT' && 'ring-1 ring-destructive/30')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={p.tone} dot={false}>
              {p.label}
            </StatusBadge>
            {/* The moment it LAST went out, not when it was written — for a repeating
                post those drift apart by weeks, and "posted 3 Aug" on something that
                went out again this morning reads as stale. */}
            <span className="text-xs text-muted-foreground">
              {a.createdBy?.name ?? 'Leadership'} · {formatDateTime(a.announcedAt || a.createdAt)}
            </span>
            {repeats ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary ring-1 ring-primary/20" title={repeats}>
                <Repeat className="size-3" /> {repeats}
              </span>
            ) : null}
            {/* Only the author sees this: a post booked for later, not out yet. Without it
                a repeating post created on a Wednesday for Saturday looked like it had
                simply vanished. */}
            {a.scheduledFor ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/12 px-2 py-0.5 text-[11px] font-medium text-amber-600 ring-1 ring-warning/25 dark:text-amber-300">
                <CalendarClock className="size-3" /> Goes out {formatDateTime(a.scheduledFor)}
              </span>
            ) : null}
          </div>
          <h3 className="mt-2 text-base font-semibold">{a.title}</h3>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {a.body ? <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/90">{a.body}</p> : null}
      {receipts}
    </GlassCard>
  );
}
