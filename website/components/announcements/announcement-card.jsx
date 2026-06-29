import { cn } from '@/lib/utils';
import { GlassCard } from '@/components/glass/glass-card';
import { StatusBadge } from '@/components/glass/status-badge';
import { PRIORITY, formatDateTime } from '@/lib/announcement';

export function AnnouncementCard({ announcement, actions }) {
  const a = announcement;
  const p = PRIORITY[a.priority] ?? PRIORITY.NORMAL;

  return (
    <GlassCard className={cn('p-5', a.priority === 'URGENT' && 'ring-1 ring-destructive/30')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={p.tone} dot={false}>
              {p.label}
            </StatusBadge>
            <span className="text-xs text-muted-foreground">
              {a.createdBy?.name ?? 'Leadership'} · {formatDateTime(a.createdAt)}
            </span>
          </div>
          <h3 className="mt-2 text-base font-semibold">{a.title}</h3>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {a.body ? <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/90">{a.body}</p> : null}
    </GlassCard>
  );
}
