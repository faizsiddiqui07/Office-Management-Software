import { cn } from '@/lib/utils';

const toneClass = {
  success: 'bg-success/12 text-success ring-success/25',
  warning: 'bg-warning/15 text-amber-600 ring-warning/30 dark:text-amber-300',
  destructive: 'bg-destructive/12 text-destructive ring-destructive/25',
  info: 'bg-info/12 text-info ring-info/25',
  primary: 'bg-primary/12 text-primary ring-primary/25',
  neutral: 'bg-muted text-muted-foreground ring-border',
};

const dotClass = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  info: 'bg-info',
  primary: 'bg-primary',
  neutral: 'bg-muted-foreground',
};

export function StatusBadge({ tone = 'neutral', dot = true, className, children, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        toneClass[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span className={cn('size-1.5 rounded-full', dotClass[tone])} /> : null}
      {children}
    </span>
  );
}

/** Maps domain statuses (attendance, leave) to a tone. Extended in later phases. */
export const STATUS_TONES = {
  PRESENT: 'success',
  ON_DUTY: 'success',
  APPROVED: 'success',
  LATE: 'warning',
  PENDING: 'warning',
  ABSENT: 'destructive',
  REJECTED: 'destructive',
  ON_LEAVE: 'info',
  HOLIDAY: 'info',
  CANCELLED: 'neutral',
};
