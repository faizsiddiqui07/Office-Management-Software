import { cn } from '@/lib/utils';
import { GlassCard } from '@/components/glass/glass-card';
import { StatusBadge } from '@/components/glass/status-badge';
import { Repeat, CalendarClock } from 'lucide-react';
import { PRIORITY, formatDateTime, describeRecurrence, datesLeft } from '@/lib/announcement';
import { RichText } from '@/components/ui/rich-text';
import { companyYMD } from '@/lib/time';

export function AnnouncementCard({ announcement, actions, receipts }) {
  const a = announcement;
  const p = PRIORITY[a.priority] ?? PRIORITY.NORMAL;
  const repeats = describeRecurrence(a.recurrence);
  // A picked-dates post with nothing left is no longer a schedule — it is a record, and a
  // "Repeat" chip there promises something that will not happen again. Worked out from the
  // clock rather than stored: there is nothing to write down, and a stored flag would need
  // somebody to go and set it.
  const spent = datesLeft(a.recurrence, companyYMD(new Date()));
  const finished = spent && spent.left === 0;

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
            {/* min-w-0 + truncate because this line is a flex-wrap row (priority, author,
                date, this, "goes out …") and a long rule used to push it apart on a phone.
                The full wording stays in the title attribute, which was already the habit
                here. */}
            {repeats ? (
              <span
                className={cn(
                  'inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
                  finished ? 'bg-muted/40 text-muted-foreground ring-border' : 'bg-primary/10 text-primary ring-primary/20',
                )}
                title={repeats}
              >
                <Repeat className="size-3 shrink-0" />
                <span className="truncate">
                  {finished ? `Went out on ${spent.total} ${spent.total === 1 ? 'date' : 'dates'} · finished` : repeats}
                </span>
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
      {a.body ? <RichText text={a.body} className="mt-2 text-sm leading-relaxed text-foreground/90" /> : null}
      {receipts}
    </GlassCard>
  );
}
