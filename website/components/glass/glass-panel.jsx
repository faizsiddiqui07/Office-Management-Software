import { cn } from '@/lib/utils';

/**
 * A larger frosted surface for page sections / shells. Static (no motion),
 * so it stays a server component.
 */
export function GlassPanel({ className, ...props }) {
  return <div className={cn('glass glass-highlight rounded-3xl', className)} {...props} />;
}
